"""Canonical public track URLs for automated catalog imports."""
from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"}
SOUNDCLOUD_HOSTS = {"soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"}


def canonical_track_url(value: str | None) -> str | None:
    if not value:
        return None
    try:
        url = urlsplit(value.strip())
        host = url.hostname
        if url.scheme not in ("http", "https") or url.username is not None or url.port is not None:
            return None
    except ValueError:
        return None

    path = url.path.rstrip("/")
    if host in YOUTUBE_HOSTS:
        video_id = ""
        if host == "youtu.be":
            video_id = path.removeprefix("/")
        elif path == "/watch":
            video_id = parse_qs(url.query).get("v", [""])[0]
        else:
            video = re.fullmatch(r"/(?:shorts|live|embed)/([a-zA-Z0-9_-]+)", path)
            if video:
                video_id = video[1]
        if re.fullmatch(r"[a-zA-Z0-9_-]{11}", video_id):
            return f"https://www.youtube.com/watch?v={video_id}"
    elif host in SOUNDCLOUD_HOSTS and re.fullmatch(r"/[a-zA-Z0-9_-]+/[a-zA-Z0-9_:-]+", path):
        return f"https://soundcloud.com{path.lower()}"
    elif host and re.fullmatch(r"[a-z0-9-]+\.bandcamp\.com", host):
        if re.fullmatch(r"/track/[a-zA-Z0-9_-]+", path):
            return f"https://{host}{path}"
    return None
