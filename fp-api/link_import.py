"""Link import: fetch audio from a URL (yt-dlp), fingerprint, ingest.

Jobs run on a small worker pool; poll GET /link/jobs/{id}.
Set IMPORT_WORKERS to change the pool size (default 3).
"""
from __future__ import annotations

import os
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

import store
from source_urls import public_web_url

WORKERS = max(1, int(os.environ.get("IMPORT_WORKERS", "3")))
_pool = ThreadPoolExecutor(max_workers=WORKERS)
JOBS: dict[str, dict] = {}
_jobs_lock = threading.Lock()

TERMINAL = {"done", "failed", "cancelled"}


class _Cancelled(Exception):
    pass


def list_jobs() -> list[dict]:
    with _jobs_lock:
        return [job.copy() for job in reversed(JOBS.values())]


def cancel_job(job_id: str) -> dict | None:
    """Request cancellation before cataloging begins, or drop a finished job."""
    with _jobs_lock:
        job = JOBS.get(job_id)
        if not job:
            return None
        if job["status"] in TERMINAL:
            del JOBS[job_id]
            return {"job_id": job_id, "removed": True}
        if job["status"] == "fingerprinting":
            return job.copy()
        job["cancel"].set()
        job["status"] = "cancelled" if job["status"] == "queued" else "cancelling"
        return job.copy()


def clear_finished() -> int:
    with _jobs_lock:
        finished = [jid for jid, j in JOBS.items() if j["status"] in TERMINAL]
        for jid in finished:
            del JOBS[jid]
        return len(finished)


def fetch_metadata(url: str) -> dict:
    import yt_dlp

    opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 20}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    release_year = info.get("release_year")
    return {
        "title": info.get("title") or "",
        "artist": info.get("artist") or info.get("uploader") or info.get("channel") or "",
        "album": info.get("playlist_title") or "",
        "year": str(release_year) if isinstance(release_year, int) and 1000 <= release_year <= 9999 else "",
        "thumbnail": public_web_url(info.get("thumbnail")),
        "duration": info.get("duration") or 0,
        "source_url": info.get("webpage_url") or url,
    }


def import_track(
    url: str, *, title: str = "", artist: str = "", album: str = "",
    year: str = "", canonical_source: bool = False,
    progress_hook: Callable[[dict], None] | None = None,
    on_indexing: Callable[[], None] | None = None,
) -> dict:
    import yt_dlp

    # Decode the provider's download directly. No intermediate transcode is needed.
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "format": "bestaudio/best",
        "socket_timeout": 30,
        "progress_hooks": [progress_hook] if progress_hook else [],
    }
    if canonical_source:
        opts["allowed_extractors"] = ["youtube", "soundcloud", "bandcamp"]
    with tempfile.TemporaryDirectory(prefix="cutdeep-link-") as tmpdir:
        opts["outtmpl"] = f"{tmpdir}/track.%(ext)s"
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
        if on_indexing:
            on_indexing()
        files = sorted(Path(tmpdir).glob("track.*"), key=lambda p: p.stat().st_size)
        if not files:
            raise RuntimeError("The source did not provide downloadable audio.")
        name = title or info.get("title") or "untitled"
        who = artist or info.get("artist") or info.get("uploader") or ""
        if canonical_source:
            album = album or info.get("album") or ""
            release_year = info.get("release_year")
            if not year and isinstance(release_year, int) and 1000 <= release_year <= 9999:
                year = str(release_year)
        bandcamp_id = str(info.get("id") or "") if info.get("extractor_key") == "Bandcamp" else ""
        return store.ingest_file(
            files[-1], name, artist=who, album=album, source_url=url, year=year,
            downloaded_from_source=True, bandcamp_track_id=bandcamp_id,
            cover_url=info.get("thumbnail") or "", canonical_source=canonical_source,
        )


def _run(job_id: str, url: str, title: str, artist: str, album: str, year: str) -> None:
    with _jobs_lock:
        job = JOBS.get(job_id)
        if not job or job["cancel"].is_set():
            return
        job["status"] = "fetching"
    try:
        started = time.monotonic()

        def hook(d: dict) -> None:
            if job["cancel"].is_set():
                raise _Cancelled()
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                done = d.get("downloaded_bytes") or 0
                elapsed = max(time.monotonic() - started, 0.001)
                with _jobs_lock:
                    job.update(
                        progress=min(1, round(done / total, 3)) if total else 0,
                        speed_bps=round(done / elapsed),
                        eta_s=max(0, round((total - done) / (done / elapsed))) if total and done else None,
                    )

        def on_indexing() -> None:
            with _jobs_lock:
                if job["cancel"].is_set():
                    raise _Cancelled()
                job.update(status="fingerprinting", progress=1.0)

        res = import_track(url, title=title, artist=artist, album=album, year=year,
                           progress_hook=hook, on_indexing=on_indexing)
        with _jobs_lock:
            job.update(**res, status="done")
    except Exception as e:  # noqa: BLE001 - surfaced to the poller
        with _jobs_lock:
            if job["cancel"].is_set():
                job.update(status="cancelled", error="")
            else:
                job.update(status="failed", error=str(e)[:300])


def start_import(url: str, *, title: str = "", artist: str = "", album: str = "", year: str = "") -> str:
    job_id = uuid.uuid4().hex[:12]
    with _jobs_lock:
        JOBS[job_id] = {
            "job_id": job_id,
            "status": "queued",
            "progress": 0.0,
            "created_at": time.time(),
            "cancel": threading.Event(),
            "title": title,
            "source_url": url,
        }
    _pool.submit(_run, job_id, url, title, artist, album, year)
    return job_id


def get_job(job_id: str) -> dict | None:
    with _jobs_lock:
        job = JOBS.get(job_id)
        return job.copy() if job else None


def public(job: dict) -> dict:
    """JSON-safe view of a job (drops the unserializable cancel event)."""
    return {k: v for k, v in job.items() if k != "cancel"}
