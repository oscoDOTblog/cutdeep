"""SQLite metadata + fingerprint storage with in-memory inverted index."""
from __future__ import annotations

import json
import os
import sqlite3
import time
from collections import Counter, defaultdict
from pathlib import Path

from fingerprint import fingerprint_file

DB_PATH = os.environ.get("DB_PATH", "/data/meta.db")
COVER_DIR = os.environ.get("COVER_DIR", "/data/covers")


def cover_url(track_id: int) -> str:
    """Public cover path, or empty when no cover is stored locally."""
    if Path(COVER_DIR, f"{track_id}.jpg").exists():
        return f"/api/covers/{track_id}.jpg"
    return ""

SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  n_hashes INTEGER DEFAULT 0,
  created_at REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS fingerprints (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  hashes TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  note TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  created_at REAL DEFAULT 0
);
"""

# hash -> list[(track_id, frame)]
INDEX: dict[int, list[tuple[int, int]]] = defaultdict(list)


def connect() -> sqlite3.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


def rebuild_index() -> int:
    INDEX.clear()
    conn = connect()
    try:
        n = 0
        for track_id, blob in conn.execute("SELECT track_id, hashes FROM fingerprints"):
            for h, t in json.loads(blob):
                INDEX[h].append((track_id, t))
                n += 1
        return n
    finally:
        conn.close()


def ingest_file(path: str | Path, title: str, artist: str = "", source_url: str = "") -> dict:
    hashes = fingerprint_file(path)
    conn = connect()
    try:
        cur = conn.execute(
            "INSERT INTO tracks (title, artist, source_url, n_hashes, created_at) VALUES (?,?,?,?,?)",
            (title, artist, source_url, len(hashes), time.time()),
        )
        track_id = cur.lastrowid or 0
        conn.execute(
            "INSERT INTO fingerprints (track_id, hashes) VALUES (?,?)",
            (track_id, json.dumps(hashes)),
        )
        conn.commit()
    finally:
        conn.close()
    for h, t in hashes:
        INDEX[h].append((track_id, t))
    return {"track_id": track_id, "title": title, "n_hashes": len(hashes)}


def match(hashes: list[tuple[int, int]], top_n: int = 5, min_votes: int = 5) -> list[dict]:
    per_track: dict[int, list[int]] = defaultdict(list)
    for h, tq in hashes:
        for track_id, tt in INDEX.get(h, []):
            per_track[track_id].append(tt - tq)
    scored = []
    for track_id, offs in per_track.items():
        best_n = Counter(offs).most_common(1)[0][1]
        if best_n >= min_votes:
            scored.append((track_id, best_n, min(best_n / max(1, len(hashes)), 1.0)))
    scored.sort(key=lambda s: -s[1])
    conn = connect()
    try:
        out = []
        for track_id, votes, conf in scored[:top_n]:
            row = conn.execute(
                "SELECT id, title, artist, source_url FROM tracks WHERE id=?",
                (track_id,),
            ).fetchone()
            if row:
                out.append({"track_id": row[0], "title": row[1], "artist": row[2],
                            "source_url": row[3], "votes": votes,
                            "confidence": round(conf, 3),
                            "cover_url": cover_url(row[0])})
        return out
    finally:
        conn.close()


def search_tracks(q: str, limit: int = 20) -> list[dict]:
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT id, title, artist, source_url FROM tracks "
            "WHERE title LIKE ? OR artist LIKE ? ORDER BY id DESC LIMIT ?",
            (f"%{q}%", f"%{q}%", limit),
        ).fetchall()
        return [{"track_id": r[0], "title": r[1], "artist": r[2], "source_url": r[3],
                 "cover_url": cover_url(r[0])} for r in rows]
    finally:
        conn.close()


def add_submission(title: str, artist: str, source_url: str, note: str) -> dict:
    conn = connect()
    try:
        cur = conn.execute(
            "INSERT INTO submissions (title, artist, source_url, note, created_at) VALUES (?,?,?,?,?)",
            (title, artist, source_url, note, time.time()),
        )
        conn.commit()
        return {"submission_id": cur.lastrowid}
    finally:
        conn.close()
