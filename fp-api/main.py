"""Cutdeep fingerprint service: ingest reference tracks, identify clips."""
from __future__ import annotations

import tempfile
from pathlib import Path

from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

import link_import
import store
from fingerprint import fingerprint_file


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    store.connect().close()
    store.rebuild_index()
    yield


app = FastAPI(title="cutdeep fp-api", lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "indexed_hashes": sum(len(v) for v in store.INDEX.values())}


@app.post("/ingest")
async def ingest(
    file: UploadFile = File(...),
    title: str = Form(""),
    artist: str = Form(""),
    source_url: str = Form(""),
) -> dict:
    suffix = Path(file.filename or "audio").suffix or ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        name = title or (file.filename or "untitled")
        return store.ingest_file(tmp_path, name, artist, source_url)
    except Exception as e:  # noqa: BLE001 - surface decode errors as 400s
        raise HTTPException(status_code=400, detail=f"ingest failed: {e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.post("/identify")
async def identify(file: UploadFile = File(...), top_n: int = 5) -> dict:
    suffix = Path(file.filename or "clip").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name
    try:
        try:
            hashes = fingerprint_file(tmp_path)
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=400, detail=f"decode failed: {e}")
        candidates = store.match(hashes, top_n=top_n)
        return {
            "query_hashes": len(hashes),
            "candidates": candidates,
            "match": candidates[0] if candidates else None,
        }
    finally:
        Path(tmp_path).unlink(missing_ok=True)


@app.post("/link/metadata")
async def link_metadata(payload: dict) -> dict:
    url = (payload.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    try:
        return link_import.fetch_metadata(url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"metadata fetch failed: {e}")


@app.post("/link/import")
async def link_import_start(payload: dict) -> dict:
    url = (payload.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    job_id = link_import.start_import(url, payload.get("title", ""), payload.get("artist", ""))
    return {"job_id": job_id}


@app.get("/link/jobs/{job_id}")
def link_job(job_id: str) -> dict:
    job = link_import.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@app.get("/search")
def search(q: str = "", limit: int = 20) -> dict:
    return {"results": store.search_tracks(q, limit)}


@app.post("/submit")
async def submit(payload: dict) -> dict:
    title = (payload.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    return store.add_submission(
        title,
        payload.get("artist", ""),
        payload.get("source_url", ""),
        payload.get("note", ""),
    )


@app.get("/submissions")
def submissions() -> dict:
    conn = store.connect()
    try:
        rows = conn.execute(
            "SELECT id, title, artist, source_url, note, status FROM submissions ORDER BY id DESC"
        ).fetchall()
        return {"submissions": [
            {"id": r[0], "title": r[1], "artist": r[2], "source_url": r[3],
             "note": r[4], "status": r[5]} for r in rows]}
    finally:
        conn.close()
