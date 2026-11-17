"""Link import: fetch audio from a URL (yt-dlp), fingerprint, ingest.

One-off jobs run on a single background thread; poll GET /link/jobs/{id}.
"""
from __future__ import annotations

import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import store

_pool = ThreadPoolExecutor(max_workers=1)
JOBS: dict[str, dict] = {}


def fetch_metadata(url: str) -> dict:
    import yt_dlp

    opts = {"quiet": True, "no_warnings": True, "noplaylist": True, "socket_timeout": 20}
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    return {
        "title": info.get("title") or "",
        "artist": info.get("artist") or info.get("uploader") or info.get("channel") or "",
        "thumbnail": info.get("thumbnail") or "",
        "duration": info.get("duration") or 0,
        "source_url": info.get("webpage_url") or url,
    }


def _run(job_id: str, url: str, title: str, artist: str) -> None:
    import yt_dlp

    job = JOBS[job_id]
    tmpdir = tempfile.mkdtemp(prefix="cutdeep-link-")
    try:
        job["status"] = "fetching"

        def hook(d: dict) -> None:
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                done = d.get("downloaded_bytes") or 0
                job["progress"] = round(done / total, 3) if total else 0

        opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "format": "bestaudio/best",
            "outtmpl": f"{tmpdir}/track.%(ext)s",
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3"}],
            "progress_hooks": [hook],
            "socket_timeout": 30,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
        files = sorted(Path(tmpdir).glob("track.*"))
        if not files:
            raise RuntimeError("download produced no audio file")
        job["status"] = "fingerprinting"
        job["progress"] = 1.0
        name = title or info.get("title") or "untitled"
        who = artist or info.get("artist") or info.get("uploader") or ""
        res = store.ingest_file(str(files[0]), name, who, url)
        job.update(status="done", track_id=res["track_id"], title=name, artist=who)
    except Exception as e:  # noqa: BLE001 - surfaced to the poller
        job.update(status="failed", error=str(e)[:300])
    finally:
        for p in Path(tmpdir).glob("*"):
            p.unlink(missing_ok=True)
        Path(tmpdir).rmdir()


def start_import(url: str, title: str = "", artist: str = "") -> str:
    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0.0,
        "created_at": time.time(),
    }
    _pool.submit(_run, job_id, url, title, artist)
    return job_id


def get_job(job_id: str) -> dict | None:
    return JOBS.get(job_id)
