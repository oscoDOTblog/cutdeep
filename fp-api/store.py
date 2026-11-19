"""SQLite metadata + fingerprint storage with in-memory inverted index."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
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
  album TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  year TEXT DEFAULT '',
  n_hashes INTEGER DEFAULT 0,
  created_at REAL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS fingerprints (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  hashes TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folder_imports (
  path TEXT PRIMARY KEY,
  track_id INTEGER NOT NULL REFERENCES tracks(id)
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
_index_lock = threading.Lock()
_indexed_through = 0


def connect() -> sqlite3.Connection:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    cols = [r[1] for r in conn.execute("PRAGMA table_info(tracks)").fetchall()]
    if "year" not in cols or "album" not in cols:
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            cols = {r[1] for r in conn.execute("PRAGMA table_info(tracks)")}
            for col in ("year", "album"):
                if col not in cols:
                    conn.execute(f"ALTER TABLE tracks ADD COLUMN {col} TEXT DEFAULT ''")
    return conn


def _refresh_index(conn: sqlite3.Connection) -> None:
    global _indexed_through
    for track_id, blob in conn.execute(
        "SELECT track_id, hashes FROM fingerprints WHERE track_id > ? ORDER BY track_id",
        (_indexed_through,),
    ):
        for h, t in json.loads(blob):
            INDEX[h].append((track_id, t))
        _indexed_through = track_id


def rebuild_index() -> int:
    global _indexed_through
    conn = connect()
    try:
        with _index_lock:
            INDEX.clear()
            _indexed_through = 0
            _refresh_index(conn)
            return sum(len(v) for v in INDEX.values())
    finally:
        conn.close()


def indexed_hash_count() -> int:
    conn = connect()
    try:
        with _index_lock:
            _refresh_index(conn)
            return sum(len(v) for v in INDEX.values())
    finally:
        conn.close()


def ingest_file(path: str | Path, title: str, artist: str = "", album: str = "",
                source_url: str = "", year: str = "", folder_path: str = "") -> dict:
    hashes = fingerprint_file(path)
    if not hashes:
        raise ValueError("no fingerprints extracted — unsupported or silent audio")
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if source_url or folder_path:
            dup_full = conn.execute(
                "SELECT id, title, artist, album, source_url, year, n_hashes FROM tracks"
                " WHERE (? != '' AND source_url = ?)"
                " OR id = (SELECT track_id FROM folder_imports WHERE path = ?) LIMIT 1",
                (source_url, source_url, folder_path),
            ).fetchone()
            if dup_full:
                return {"track_id": dup_full[0], "title": dup_full[1],
                        "artist": dup_full[2], "album": dup_full[3] or "",
                        "source_url": dup_full[4], "year": dup_full[5] or "",
                        "n_hashes": dup_full[6], "deduped": True}
        cur = conn.execute(
            "INSERT INTO tracks (title, artist, album, source_url, year, n_hashes, created_at)"
            " VALUES (?,?,?,?,?,?,?)",
            (title, artist, album, source_url, year, len(hashes), time.time()),
        )
        track_id = cur.lastrowid or 0
        conn.execute(
            "INSERT INTO fingerprints (track_id, hashes) VALUES (?,?)",
            (track_id, json.dumps(hashes)),
        )
        if folder_path:
            conn.execute("INSERT INTO folder_imports (path, track_id) VALUES (?, ?)",
                         (folder_path, track_id))
        conn.commit()
    finally:
        conn.close()
    return {"track_id": track_id, "title": title, "artist": artist,
            "album": album, "source_url": source_url, "year": year,
            "n_hashes": len(hashes), "deduped": False}


def match(hashes: list[tuple[int, int]], top_n: int = 5, min_votes: int = 10,
          min_conf: float = 0.1) -> list[dict]:
    conn = connect()
    try:
        per_track: dict[int, list[int]] = defaultdict(list)
        with _index_lock:
            _refresh_index(conn)
            for h, tq in hashes:
                for track_id, tt in INDEX.get(h, []):
                    per_track[track_id].append(tt - tq)
        scored = []
        for track_id, offs in per_track.items():
            best_n = Counter(offs).most_common(1)[0][1]
            conf = min(best_n / max(1, len(hashes)), 1.0)
            if best_n >= min_votes and conf >= min_conf:
                scored.append((track_id, best_n, conf))
        scored.sort(key=lambda s: -s[1])
        out = []
        for track_id, votes, conf in scored[:top_n]:
            row = conn.execute(
                "SELECT id, title, artist, album, source_url, year FROM tracks WHERE id=?",
                (track_id,),
            ).fetchone()
            if row:
                out.append({"track_id": row[0], "title": row[1], "artist": row[2],
                            "album": row[3] or "", "source_url": row[4],
                            "year": row[5] or "", "votes": votes,
                            "confidence": round(conf, 3),
                            "cover_url": cover_url(row[0])})
        return out
    finally:
        conn.close()


def search_tracks(q: str, limit: int = 20, before: int | None = None) -> list[dict]:
    conn = connect()
    try:
        conn.create_function("casefold", 1, str.casefold)
        rows = conn.execute(
            "SELECT id, title, artist, album, source_url, year, n_hashes FROM tracks "
            "WHERE id < coalesce(?, 9223372036854775807)"
            " AND (? = '' OR instr(casefold(title || ' ' || coalesce(artist, '')"
            " || ' ' || coalesce(album, '')), ?) > 0)"
            " ORDER BY id DESC LIMIT ?",
            (before, q, q.casefold(), limit),
        ).fetchall()
        return [{"track_id": r[0], "title": r[1], "artist": r[2], "album": r[3] or "",
                 "source_url": r[4], "year": r[5] or "", "n_hashes": r[6],
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
