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


def save_cover(track_id: int, thumb_url: str) -> str:
    """Download a thumbnail and normalize it to a local jpg. Never fatal."""
    import subprocess
    import urllib.request

    if not thumb_url:
        return ""
    try:
        Path(store.COVER_DIR).mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(thumb_url, headers={"User-Agent": "Mozilla/5.0"})
        with tempfile.NamedTemporaryFile(suffix=".img", delete=False) as tmp:
            tmp.write(urllib.request.urlopen(req, timeout=20).read())
            src = tmp.name
        try:
            dest = str(Path(store.COVER_DIR, f"{track_id}.jpg"))
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", src,
                 "-vf", "scale=512:-1", "-q:v", "4", dest],
                check=True, timeout=30,
            )
            return store.cover_url(track_id)
        finally:
            Path(src).unlink(missing_ok=True)
    except Exception:  # noqa: BLE001 - a missing cover never fails the import
        return ""


def _run(job_id: str, url: str, title: str, artist: str, thumb_url: str = "") -> None:
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
        cover = save_cover(res["track_id"], thumb_url or info.get("thumbnail") or "")
        job.update(status="done", track_id=res["track_id"], title=name, artist=who,
                   cover_url=cover)
    except Exception as e:  # noqa: BLE001 - surfaced to the poller
        job.update(status="failed", error=str(e)[:300])
    finally:
        for p in Path(tmpdir).glob("*"):
            p.unlink(missing_ok=True)
        Path(tmpdir).rmdir()


def start_import(url: str, title: str = "", artist: str = "", thumb_url: str = "") -> str:
    job_id = uuid.uuid4().hex[:12]
    JOBS[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "progress": 0.0,
        "created_at": time.time(),
    }
    _pool.submit(_run, job_id, url, title, artist, thumb_url)
    return job_id


def get_job(job_id: str) -> dict | None:
    return JOBS.get(job_id)
