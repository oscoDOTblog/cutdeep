"""Cutdeep fingerprint service: ingest reference tracks, identify clips."""
from __future__ import annotations

import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.staticfiles import StaticFiles

import link_import
import store
from fingerprint import fingerprint_file


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    store.rebuild_index()
    yield


app = FastAPI(title="cutdeep fp-api", lifespan=lifespan)

Path(store.COVER_DIR).mkdir(parents=True, exist_ok=True)
app.mount("/covers", StaticFiles(directory=store.COVER_DIR), name="covers")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "indexed_hashes": store.indexed_hash_count()}


@app.post("/ingest")
def ingest(
    file: UploadFile = File(...),
    title: str = Form(""),
    artist: str = Form(""),
    album: str = Form(""),
    source_url: str = Form(""),
    year: str = Form(""),
    cover: UploadFile | None = File(default=None),
) -> dict:
    suffix = Path(file.filename or "audio").suffix or ".mp3"
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp.flush()
            name = title or (file.filename or "untitled")
            res = store.ingest_file(tmp.name, name, artist=artist, album=album,
                                    source_url=source_url, year=year)
    except Exception as e:  # noqa: BLE001 - surface decode errors as 400s
        raise HTTPException(status_code=400, detail=f"ingest failed: {e}")
    if cover is not None and not res["deduped"]:
        link_import.save_cover_bytes(res["track_id"], cover.file.read())
    res["cover_url"] = store.cover_url(res["track_id"])
    return res


@app.post("/identify")
def identify(file: UploadFile = File(...), top_n: int = Query(5, ge=1, le=50)) -> dict:
    suffix = Path(file.filename or "clip").suffix or ".wav"
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp.flush()
            hashes = fingerprint_file(tmp.name)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"decode failed: {e}")
    candidates = store.match(hashes, top_n=top_n)
    return {
        "query_hashes": len(hashes),
        "candidates": candidates,
        "match": candidates[0] if candidates else None,
    }


@app.post("/link/metadata")
def link_metadata(payload: dict) -> dict:
    url = (payload.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    try:
        return link_import.fetch_metadata(url)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"metadata fetch failed: {e}")


@app.post("/link/import")
async def link_import_start(
    url: str = Form(""),
    title: str = Form(""),
    artist: str = Form(""),
    thumbnail: str = Form(""),
    album: str = Form(""),
    cover: UploadFile | None = File(default=None),
) -> dict:
    url = url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    raw = await cover.read() if cover is not None else b""
    job_id = link_import.start_import(url, title, artist, thumbnail, album, raw)
    return {"job_id": job_id}


@app.get("/link/jobs")
def link_jobs() -> dict:
    return {"jobs": [link_import.public(j) for j in link_import.list_jobs()]}


@app.get("/link/jobs/{job_id}")
def link_job(job_id: str) -> dict:
    job = link_import.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return link_import.public(job)


@app.delete("/link/jobs/{job_id}")
def link_job_cancel(job_id: str) -> dict:
    job = link_import.cancel_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job if job.get("removed") else link_import.public(job)


@app.delete("/link/jobs")
def link_jobs_clear() -> dict:
    return {"cleared": link_import.clear_finished()}


@app.get("/search")
def search(q: str = "", limit: int = Query(20, ge=1, le=500),
           before: int | None = Query(None, ge=1)) -> dict:
    rows = store.search_tracks(q.strip(), limit + 1, before)
    return {"results": rows[:limit], "next_before": rows[limit - 1]["track_id"] if len(rows) > limit else None}


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
