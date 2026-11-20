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

import store

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
        "thumbnail": info.get("thumbnail") or "",
        "duration": info.get("duration") or 0,
        "source_url": info.get("webpage_url") or url,
    }


def _cover_from_file(track_id: int, src: str) -> str:
    """Normalize an image file to a local 512px jpg. Never fatal."""
    import subprocess

    try:
        Path(store.COVER_DIR).mkdir(parents=True, exist_ok=True)
        dest = Path(store.COVER_DIR, f"{track_id}.jpg")
        with tempfile.NamedTemporaryFile(suffix=".jpg", dir=store.COVER_DIR, delete=False) as tmp:
            output = Path(tmp.name)
        try:
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", src,
                 "-vf", "scale=512:-1", "-frames:v", "1", "-q:v", "4", str(output)],
                check=True, timeout=30,
            )
            if output.stat().st_size:
                output.replace(dest)
        finally:
            output.unlink(missing_ok=True)
        return store.cover_url(track_id)
    except Exception:  # noqa: BLE001 - a missing cover never fails the import
        return ""


def save_cover(track_id: int, thumb_url: str) -> str:
    """Download a thumbnail and normalize it to a local jpg. Never fatal."""
    import urllib.request

    if not thumb_url:
        return ""
    try:
        req = urllib.request.Request(thumb_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as response:
            return save_cover_bytes(track_id, response.read())
    except Exception:  # noqa: BLE001 - artwork is optional
        return ""


def save_cover_bytes(track_id: int, raw: bytes) -> str:
    """Store an uploaded cover image for a track. Never fatal."""
    if not raw:
        return ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".img") as tmp:
            tmp.write(raw)
            tmp.flush()
            return _cover_from_file(track_id, tmp.name)
    except OSError:
        return ""


def _run(job_id: str, url: str, title: str, artist: str, thumb_url: str = "",
         album: str = "", cover_bytes: bytes = b"", year: str = "") -> None:
    import yt_dlp

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

        # No transcode: the fingerprinter decodes any format directly,
        # so ingesting the download as-is skips a full ffmpeg pass.
        opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "format": "bestaudio/best",
            "progress_hooks": [hook],
            "socket_timeout": 30,
        }
        with tempfile.TemporaryDirectory(prefix="cutdeep-link-") as tmpdir:
            opts["outtmpl"] = f"{tmpdir}/track.%(ext)s"
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
            with _jobs_lock:
                if job["cancel"].is_set():
                    raise _Cancelled()
                job.update(status="fingerprinting", progress=1.0)
            files = sorted(Path(tmpdir).glob("track.*"), key=lambda p: p.stat().st_size)
            if not files:
                raise RuntimeError("download produced no audio file")
            name = title or info.get("title") or "untitled"
            who = artist or info.get("artist") or info.get("uploader") or ""
            bandcamp_id = str(info.get("id") or "") if info.get("extractor_key") == "Bandcamp" else ""
            res = store.ingest_file(files[-1], name, artist=who, album=album, source_url=url,
                                    year=year, downloaded_from_source=True, bandcamp_track_id=bandcamp_id)
        track_id = res["track_id"]
        if not res["deduped"]:
            if cover_bytes:
                save_cover_bytes(track_id, cover_bytes)
            else:
                save_cover(track_id, thumb_url or info.get("thumbnail") or "")
        with _jobs_lock:
            job.update(**res, status="done", cover_url=store.cover_url(track_id))
    except Exception as e:  # noqa: BLE001 - surfaced to the poller
        with _jobs_lock:
            if job["cancel"].is_set():
                job.update(status="cancelled", error="")
            else:
                job.update(status="failed", error=str(e)[:300])


def start_import(url: str, title: str = "", artist: str = "", thumb_url: str = "",
                 album: str = "", cover_bytes: bytes = b"", *, year: str = "") -> str:
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
    _pool.submit(_run, job_id, url, title, artist, thumb_url, album, cover_bytes, year=year)
    return job_id


def get_job(job_id: str) -> dict | None:
    with _jobs_lock:
        job = JOBS.get(job_id)
        return job.copy() if job else None


def public(job: dict) -> dict:
    """JSON-safe view of a job (drops the unserializable cancel event)."""
    return {k: v for k, v in job.items() if k != "cancel"}
