"""Cutdeep fingerprint service: ingest reference tracks, identify clips."""
from __future__ import annotations

import re
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from threading import Event, Thread

from fastapi import FastAPI, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.datastructures import UploadFile as FormUpload

import catalog_import
import link_import
import store
from fingerprint import decode_mono, fingerprint_hashes, speaker_hashes
from source_urls import canonical_track_url


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    store.rebuild_index()
    stop = Event()
    worker = Thread(target=catalog_import.run_worker, args=(stop,), name="catalog-imports", daemon=True)
    worker.start()
    try:
        yield
    finally:
        stop.set()
        await run_in_threadpool(worker.join, 1)


app = FastAPI(title="cutdeep fp-api", lifespan=lifespan)

@app.get("/health")
def health() -> dict:
    return {"ok": True, "indexed_hashes": store.indexed_hash_count()}


def _import_details(values) -> dict[str, str]:
    details = {}
    for key in ("title", "artist", "album", "year"):
        value = values.get(key)
        if value is None:
            value = ""
        if key == "year" and type(value) is int:
            value = str(value)
        if not isinstance(value, str):
            raise HTTPException(status_code=400, detail=f"{key} must be text.")
        details[key] = value.strip()
    if details["year"] and not re.fullmatch(r"[1-9][0-9]{3}", details["year"]):
        raise HTTPException(status_code=400, detail="Enter a four-digit release year.")
    return details


@app.post("/catalog/imports", status_code=202)
async def create_catalog_import(request: Request) -> JSONResponse:
    media_type = request.headers.get("content-type", "").partition(";")[0].strip().lower()
    if media_type == "application/json":
        try:
            body = await request.json()
        except (ValueError, UnicodeError):
            raise HTTPException(status_code=400, detail="Send a JSON object with a track URL.")
        value = body.get("url") if isinstance(body, dict) else None
        url = canonical_track_url(value) if isinstance(value, str) else None
        if url is None:
            raise HTTPException(status_code=400, detail="Enter a public YouTube, SoundCloud, or Bandcamp track URL.")
        result = await run_in_threadpool(catalog_import.queue_url, url, _import_details(body))
    elif media_type == "multipart/form-data":
        async with request.form(max_files=1, max_fields=5) as form:
            file = form.get("file")
            if not isinstance(file, FormUpload):
                raise HTTPException(status_code=400, detail="Attach an audio file in the file field.")
            details = _import_details(form)
            details["title"] = details["title"] or Path(file.filename or "").stem or "untitled"
            try:
                result = await run_in_threadpool(catalog_import.queue_file, file.file, details)
            except catalog_import.UploadTooLarge as e:
                raise HTTPException(status_code=413, detail=str(e))
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
    else:
        raise HTTPException(status_code=415, detail="Send a JSON track URL or a multipart audio file.")
    return JSONResponse(result, status_code=202, headers={"Location": result["status_url"]})


@app.get("/catalog/imports/{import_id}")
def catalog_import_status(import_id: str) -> dict:
    result = catalog_import.get_import(import_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Catalog import not found.")
    return result


@app.post("/ingest")
def ingest(
    file: UploadFile = File(...),
    title: str = Form(""),
    artist: str = Form(""),
    album: str = Form(""),
    source_url: str = Form(""),
    year: str = Form(""),
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
    return res


@app.post("/identify")
def identify(file: UploadFile = File(...), top_n: int = Query(5, ge=1, le=50)) -> dict:
    suffix = Path(file.filename or "clip").suffix or ".wav"
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            tmp.flush()
            samples = decode_mono(tmp.name)
            hashes = fingerprint_hashes(samples)
            speaker = speaker_hashes(samples)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"decode failed: {e}")
    candidates = store.match(hashes, top_n=top_n, speaker=speaker)
    return {
        "query_hashes": len(hashes) + len(speaker),
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
    album: str = Form(""),
    year: str = Form(""),
) -> dict:
    url = url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="url is required")
    year = year.strip()
    if year and not re.fullmatch(r"[1-9][0-9]{3}", year):
        raise HTTPException(status_code=400, detail="Enter a four-digit release year.")
    job_id = link_import.start_import(url, title=title, artist=artist, album=album, year=year)
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


class TrackDetails(BaseModel):
    title: str
    artist: str
    album: str
    year: str


@app.patch("/tracks/{track_id}")
def update_track(track_id: int, details: TrackDetails) -> dict:
    title, artist, album, year = (value.strip() for value in (
        details.title, details.artist, details.album, details.year,
    ))
    if not title:
        raise HTTPException(status_code=400, detail="Enter a title for this track.")
    if year and not re.fullmatch(r"[1-9][0-9]{3}", year):
        raise HTTPException(status_code=400, detail="Enter a four-digit release year.")
    if not store.update_track(track_id, title, artist, album, year):
        raise HTTPException(status_code=404, detail="This track is no longer in the catalog.")
    return {"title": title, "artist": artist, "album": album, "year": year}


@app.delete("/tracks/{track_id}")
def remove_track(track_id: int) -> dict:
    if not store.remove_track(track_id):
        raise HTTPException(status_code=404, detail="This track is no longer in the catalog.")
    return {"removed": True}


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
