"""Durable queue for importing reference audio from a file or public track URL."""
from __future__ import annotations

import fcntl
import hashlib
import json
import logging
import os
import sqlite3
import subprocess
import tempfile
import time
import uuid
from contextlib import closing
from pathlib import Path
from threading import Event
from typing import BinaryIO

import link_import
import store

SPOOL = Path(f"{store.DB_PATH}-imports")
MAX_UPLOAD_BYTES = max(1, int(os.environ.get("CATALOG_IMPORT_MAX_BYTES", str(256 * 1024 * 1024))))
logger = logging.getLogger(__name__)


class UploadTooLarge(ValueError):
    pass


def _staged_path(import_id: str) -> Path:
    return SPOOL / f"{import_id}.audio"


def _discard(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not remove staged catalog upload %s", path.name)


def _public(row: sqlite3.Row) -> dict:
    import_id = row["id"]
    result = {
        "import_id": import_id,
        "status_url": f"/api/catalog/imports/{import_id}",
        "status": row["status"],
    }
    if row["status"] == "ready":
        result.update(track_id=row["track_id"], deduped=bool(row["deduped"]))
    elif row["status"] == "failed":
        result["error"] = row["error"]
    return result


def get_import(import_id: str) -> dict | None:
    with closing(store.connect()) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM catalog_imports WHERE id = ?", (import_id,)).fetchone()
    return _public(row) if row else None


def _enqueue(kind: str, source: str, details: dict, stage: Path | None = None) -> dict:
    import_id = uuid.uuid4().hex
    staged = _staged_path(import_id)
    moved = False
    try:
        with closing(store.connect()) as conn, conn:
            conn.row_factory = sqlite3.Row
            conn.execute("BEGIN IMMEDIATE")
            prior = conn.execute(
                "SELECT * FROM catalog_imports i WHERE kind = ? AND source = ?"
                " AND (status IN ('queued', 'processing') OR"
                "      (status = 'ready' AND EXISTS"
                "       (SELECT 1 FROM fingerprints f WHERE f.track_id = i.track_id)))"
                " ORDER BY created_at DESC LIMIT 1",
                (kind, source),
            ).fetchone()
            if prior:
                return {**_public(prior), "reused_import": True}
            if stage is not None:
                stage.replace(staged)
                moved = True
            conn.execute(
                "INSERT INTO catalog_imports (id, kind, source, details, status, created_at)"
                " VALUES (?, ?, ?, ?, 'queued', ?)",
                (import_id, kind, source, json.dumps(details), time.time()),
            )
    except Exception:
        if moved:
            _discard(staged)
        raise
    return {"import_id": import_id, "status_url": f"/api/catalog/imports/{import_id}",
            "status": "queued", "reused_import": False}


def queue_url(url: str, details: dict) -> dict:
    return _enqueue("url", url, details)


def queue_file(file: BinaryIO, details: dict) -> dict:
    SPOOL.mkdir(mode=0o700, parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    with tempfile.NamedTemporaryFile(prefix=".upload-", dir=SPOOL, delete=False) as stage:
        path = Path(stage.name)
        try:
            while chunk := file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise UploadTooLarge(f"Audio files must be at most {MAX_UPLOAD_BYTES} bytes.")
                stage.write(chunk)
                digest.update(chunk)
            if not size:
                raise ValueError("Upload a non-empty audio file.")
            stage.flush()
            os.fsync(stage.fileno())
            return _enqueue("file", digest.hexdigest(), details, path)
        finally:
            _discard(path)


def _claim() -> sqlite3.Row | None:
    with closing(store.connect()) as conn, conn:
        conn.row_factory = sqlite3.Row
        conn.execute("BEGIN IMMEDIATE")
        job = conn.execute(
            "SELECT * FROM catalog_imports WHERE status IN ('queued', 'processing')"
            " ORDER BY created_at, id LIMIT 1",
        ).fetchone()
        if job:
            conn.execute("UPDATE catalog_imports SET status = 'processing' WHERE id = ?", (job["id"],))
        return job


def _complete(import_id: str, result: dict | None, error: str = "") -> None:
    with closing(store.connect()) as conn, conn:
        if result is not None:
            conn.execute(
                "UPDATE catalog_imports SET status = 'ready', track_id = ?, deduped = ?, error = NULL"
                " WHERE id = ?",
                (result["track_id"], result["deduped"], import_id),
            )
        else:
            conn.execute(
                "UPDATE catalog_imports SET status = 'failed', error = ? WHERE id = ?",
                (error, import_id),
            )


def _process(job: sqlite3.Row) -> None:
    import_id = job["id"]
    path = _staged_path(import_id)
    is_file = job["kind"] == "file"
    details = json.loads(job["details"])
    result = None
    error = ""
    try:
        if is_file:
            if not path.is_file():
                error = "The staged file is unavailable. Upload the file again."
            else:
                result = store.ingest_file(path, file_sha256=job["source"], **details)
        else:
            track_id = store.find_source_track(job["source"])
            if track_id is None:
                result = link_import.import_track(job["source"], canonical_source=True, **details)
            else:
                result = {"track_id": track_id, "deduped": True}
    except (ValueError, subprocess.CalledProcessError):
        error = ("No usable audio found. Upload a supported audio file with audible music." if is_file
                 else "No usable audio found at this URL. Check that the track is public and playable.")
        logger.exception("Could not decode catalog import %s", import_id)
    except Exception:
        error = ("Could not index the audio. Submit the file again." if is_file else
                 "Could not import this URL. Check that it points to a public, playable track and retry.")
        logger.exception("Could not process catalog import %s", import_id)
    _complete(import_id, result, error)
    if is_file:
        _discard(path)


def _clear_finished_uploads() -> None:
    with closing(store.connect()) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        pending = {
            _staged_path(row[0]) for row in conn.execute(
                "SELECT id FROM catalog_imports WHERE kind = 'file' AND status IN ('queued', 'processing')"
            )
        }
        for path in SPOOL.glob("*.audio"):
            if path not in pending:
                _discard(path)


def run_worker(stop: Event) -> None:
    cleaned = False
    while not stop.is_set():
        try:
            SPOOL.mkdir(mode=0o700, parents=True, exist_ok=True)
            with (SPOOL / ".worker").open("a") as lock:
                # The OS releases this lock on process exit, so the next worker
                # can resume a processing job without racing a live worker.
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    stop.wait(1)
                    continue
                if not cleaned:
                    _clear_finished_uploads()
                    cleaned = True
                job = _claim()
                if job:
                    _process(job)
                    continue
        except Exception:
            logger.exception("Catalog import worker could not process the queue")
        stop.wait(1)
