"""SQLite metadata + fingerprint storage with in-memory inverted index."""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import subprocess
import tempfile
import threading
import time
from collections import Counter, defaultdict
from pathlib import Path

from fingerprint import SPEAKER_HOP, SR, decode_mono, fingerprint_hashes, speaker_hashes

DB_PATH = os.environ.get("DB_PATH", "/data/meta.db")
COVER_DIR = os.environ.get("COVER_DIR", "/data/covers")
PREVIEW_DIR = Path(DB_PATH).with_name("previews")
logger = logging.getLogger(__name__)


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
CREATE TABLE IF NOT EXISTS speaker_fingerprints (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
  hashes TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bandcamp_tracks (
  track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS folder_imports (
  path TEXT PRIMARY KEY,
  track_id INTEGER NOT NULL REFERENCES tracks(id)
);
CREATE TABLE IF NOT EXISTS catalog_removals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id)
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
SPEAKER_INDEX: dict[int, list[tuple[int, int]]] = defaultdict(list)
_index_lock = threading.Lock()
_indexed_through = 0
_speaker_indexed_through = 0
_removals_through = 0


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
    global _indexed_through, _speaker_indexed_through, _removals_through
    latest_removal = conn.execute("SELECT coalesce(max(id), 0) FROM catalog_removals").fetchone()[0]
    if latest_removal != _removals_through:
        INDEX.clear()
        SPEAKER_INDEX.clear()
        _indexed_through = 0
        _speaker_indexed_through = 0
        _removals_through = latest_removal
    for track_id, blob in conn.execute(
        "SELECT track_id, hashes FROM fingerprints WHERE track_id > ? ORDER BY track_id",
        (_indexed_through,),
    ):
        for h, t in json.loads(blob):
            INDEX[h].append((track_id, t))
        _indexed_through = track_id
    # A previously uploaded track can gain speaker landmarks later.
    for entry_id, track_id, blob in conn.execute(
        "SELECT id, track_id, hashes FROM speaker_fingerprints WHERE id > ? ORDER BY id",
        (_speaker_indexed_through,),
    ):
        for h, t in json.loads(blob):
            SPEAKER_INDEX[h].append((track_id, t))
        _speaker_indexed_through = entry_id


def _index_size() -> int:
    return sum(map(len, INDEX.values())) + sum(map(len, SPEAKER_INDEX.values()))


def rebuild_index() -> int:
    global _indexed_through, _speaker_indexed_through
    conn = connect()
    try:
        with _index_lock:
            INDEX.clear()
            SPEAKER_INDEX.clear()
            _indexed_through = 0
            _speaker_indexed_through = 0
            conn.execute("BEGIN")
            _refresh_index(conn)
            return _index_size()
    finally:
        conn.close()


def indexed_hash_count() -> int:
    conn = connect()
    try:
        with _index_lock:
            conn.execute("BEGIN")
            _refresh_index(conn)
            return _index_size()
    finally:
        conn.close()


def _add_speaker_fingerprints(conn: sqlite3.Connection, track_id: int,
                              hashes: list[tuple[int, int]], blob: str) -> None:
    inserted = conn.execute(
        "INSERT INTO speaker_fingerprints (track_id, hashes) VALUES (?,?)"
        " ON CONFLICT (track_id) DO NOTHING",
        (track_id, blob),
    )
    if inserted.rowcount:
        conn.execute("UPDATE tracks SET n_hashes = n_hashes + ? WHERE id = ?", (len(hashes), track_id))


def _preview_file(track_id: int) -> Path:
    return PREVIEW_DIR / f"{track_id}.mp3"


def _track_is_active(conn: sqlite3.Connection, track_id: int) -> bool:
    return conn.execute(
        "SELECT 1 FROM tracks WHERE id = ? AND id NOT IN (SELECT track_id FROM catalog_removals)",
        (track_id,),
    ).fetchone() is not None


def track_preview(track_id: int) -> Path | None:
    path = _preview_file(track_id)
    if not path.is_file():
        return None
    conn = connect()
    try:
        return path if _track_is_active(conn, track_id) else None
    finally:
        conn.close()


def _save_preview(path: str | Path, track_id: int, duration: float) -> None:
    dest = _preview_file(track_id)
    if dest.is_file():
        return
    try:
        PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=PREVIEW_DIR) as tmp:
            clip = Path(tmp, "preview.mp3")
            start = min(30, max(0, (duration - 30) / 3))
            subprocess.run(
                ["ffmpeg", "-nostdin", "-v", "error", "-abort_on", "empty_output",
                 "-i", str(path), "-ss", str(start),
                 "-map", "0:a:0", "-map_metadata", "-1", "-t", "30", "-c:a", "libmp3lame",
                 "-b:a", "96k", str(clip)],
                check=True, timeout=30,
            )
            conn = connect()
            try:
                with conn:
                    conn.execute("BEGIN IMMEDIATE")
                    if _track_is_active(conn, track_id):
                        clip.replace(dest)
            finally:
                conn.close()
    except (OSError, sqlite3.Error, subprocess.SubprocessError):
        logger.warning("Could not create the audio preview for track %s", track_id)


def ingest_file(path: str | Path, title: str, artist: str = "", album: str = "",
                source_url: str = "", year: str = "", folder_path: str = "",
                downloaded_from_source: bool = False, bandcamp_track_id: str = "") -> dict:
    samples = decode_mono(path)
    hashes = fingerprint_hashes(samples)
    speaker = speaker_hashes(samples)
    if not hashes:
        raise ValueError("no fingerprints extracted — unsupported or silent audio")
    legacy_blob = json.dumps(hashes)
    speaker_blob = json.dumps(speaker)
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        if speaker:
            # Backfill every older copy of the same audio when a reference is available again.
            older_copies = conn.execute(
                "SELECT f.track_id FROM fingerprints f JOIN tracks t ON t.id = f.track_id"
                " WHERE t.n_hashes = ? AND f.hashes = ?"
                " AND NOT EXISTS (SELECT 1 FROM speaker_fingerprints s WHERE s.track_id = f.track_id)",
                (len(hashes), legacy_blob),
            ).fetchall()
            for (track_id,) in older_copies:
                _add_speaker_fingerprints(conn, track_id, speaker, speaker_blob)
        if source_url or folder_path:
            duplicate = conn.execute(
                "SELECT id FROM tracks"
                " WHERE (? != '' AND source_url = ?"
                " AND id NOT IN (SELECT track_id FROM catalog_removals))"
                " OR id = (SELECT track_id FROM folder_imports WHERE path = ?) LIMIT 1",
                (source_url, source_url, folder_path),
            ).fetchone()
        else:
            duplicate = conn.execute(
                "SELECT t.id FROM tracks t JOIN fingerprints f ON f.track_id = t.id"
                " WHERE t.title = ? AND t.artist = ? AND coalesce(t.album, '') = ?"
                " AND t.source_url = '' AND coalesce(t.year, '') = ? AND f.hashes = ? LIMIT 1",
                (title, artist, album, year, legacy_blob),
            ).fetchone()
        if duplicate:
            track_id = duplicate[0]
            if speaker and downloaded_from_source:
                _add_speaker_fingerprints(conn, track_id, speaker, speaker_blob)
            row = conn.execute(
                "SELECT title, artist, album, source_url, year, n_hashes FROM tracks WHERE id = ?",
                (track_id,),
            ).fetchone()
            result = {"track_id": track_id, "title": row[0], "artist": row[1],
                      "album": row[2] or "", "source_url": row[3], "year": row[4] or "",
                      "n_hashes": row[5], "deduped": True}
        else:
            cur = conn.execute(
                "INSERT INTO tracks (title, artist, album, source_url, year, n_hashes, created_at)"
                " VALUES (?,?,?,?,?,?,?)",
                (title, artist, album, source_url, year, len(hashes), time.time()),
            )
            track_id = cur.lastrowid or 0
            conn.execute(
                "INSERT INTO fingerprints (track_id, hashes) VALUES (?,?)",
                (track_id, legacy_blob),
            )
            if speaker:
                _add_speaker_fingerprints(conn, track_id, speaker, speaker_blob)
            if folder_path:
                conn.execute("INSERT INTO folder_imports (path, track_id) VALUES (?, ?)",
                             (folder_path, track_id))
            result = {"track_id": track_id, "title": title, "artist": artist, "album": album,
                      "source_url": source_url, "year": year,
                      "n_hashes": len(hashes) + len(speaker), "deduped": False}
        if re.fullmatch(r"[0-9]+", bandcamp_track_id):
            conn.execute(
                "INSERT OR IGNORE INTO bandcamp_tracks (track_id, provider_id) VALUES (?, ?)",
                (track_id, bandcamp_track_id),
            )
        conn.commit()
    finally:
        conn.close()
    if not downloaded_from_source and (not duplicate or not (source_url or folder_path)):
        _save_preview(path, track_id, len(samples) / SR)
    return result


def _speaker_scores(hashes: list[tuple[int, int]]) -> list[tuple[int, int, float]]:
    per_offset: dict[tuple[int, int], set[int]] = defaultdict(set)
    for i, (h, query_frame) in enumerate(hashes):
        for track_id, ref_frame in SPEAKER_INDEX.get(h, []):
            offset = ref_frame - query_frame
            for near in (offset - 1, offset, offset + 1):
                per_offset[track_id, near].add(i)

    best: dict[int, int] = {}
    for (track_id, _), hits in per_offset.items():
        votes = len(hits)
        if votes < max(18, 0.12 * len(hashes)) or votes <= best.get(track_id, 0):
            continue
        frames = {hashes[i][1] for i in hits}
        # Require evidence from different parts of the recording.
        if len(frames) >= 12 and len({2 * t * SPEAKER_HOP // SR for t in frames}) >= 3:
            best[track_id] = votes
    return [(track_id, votes, votes / len(hashes)) for track_id, votes in best.items()]


def _legacy_scores(hashes: list[tuple[int, int]], min_votes: int,
                   min_conf: float) -> list[tuple[int, int, float]]:
    per_track: dict[int, Counter[int]] = defaultdict(Counter)
    for h, query_frame in hashes:
        for track_id, ref_frame in INDEX.get(h, []):
            per_track[track_id][ref_frame - query_frame] += 1
    scored = []
    for track_id, offsets in per_track.items():
        votes = max(offsets.values())
        conf = min(votes / len(hashes), 1.0)
        if votes >= min_votes and conf >= min_conf:
            scored.append((track_id, votes, conf))
    return scored


def _song_key(title: str, artist: str | None) -> tuple[str, str]:
    return (title.strip().casefold(), (artist or "").strip().casefold())


def _match_status(conn: sqlite3.Connection, top: dict,
                  scored: list[tuple[int, int, float]], used_speaker: bool) -> str:
    votes = top["votes"]
    min_overlap = 0.18 if used_speaker else 0.4
    if votes < 50 or top["confidence"] < min_overlap:
        return "possible"

    song = _song_key(top["title"], top["artist"])
    for track_id, rival_votes, _ in scored:
        if votes * 2 >= rival_votes * 3:
            break
        if track_id == top["track_id"]:
            continue
        row = conn.execute("SELECT title, artist FROM tracks WHERE id = ?", (track_id,)).fetchone()
        if row and _song_key(*row) != song:
            return "possible"
    return "likely"


def match(hashes: list[tuple[int, int]], top_n: int = 5, min_votes: int = 10,
          min_conf: float = 0.1, speaker: list[tuple[int, int]] | None = None) -> list[dict]:
    conn = connect()
    try:
        with _index_lock:
            conn.execute("BEGIN")
            _refresh_index(conn)
            scored = _speaker_scores(speaker) if speaker else []
            used_speaker = bool(scored)
            if not used_speaker:
                scored = _legacy_scores(hashes, min_votes, min_conf)
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
        if out:
            top = out[0]
            top["match_status"] = _match_status(conn, top, scored, used_speaker)
            if top["match_status"] == "likely":
                track_id = top["track_id"]
                if _preview_file(track_id).is_file():
                    top["preview_url"] = f"/api/tracks/{track_id}/preview"
                bandcamp = conn.execute(
                    "SELECT provider_id FROM bandcamp_tracks WHERE track_id = ?", (track_id,),
                ).fetchone()
                if bandcamp:
                    top["bandcamp_track_id"] = bandcamp[0]
        return out
    finally:
        conn.close()


def search_tracks(q: str, limit: int = 20, before: int | None = None) -> list[dict]:
    conn = connect()
    try:
        query = q.casefold()
        terms = re.findall(r"[^\W_]+", query)

        def catalog_matches(metadata: str) -> bool:
            folded = metadata.casefold()
            if query in folded:
                return True
            return bool(terms) and all(term in folded for term in terms)

        conn.create_function("catalog_matches", 1, catalog_matches)
        rows = conn.execute(
            "SELECT id, title, artist, album, source_url, year, n_hashes FROM tracks "
            "WHERE id < coalesce(?, 9223372036854775807)"
            " AND id NOT IN (SELECT track_id FROM catalog_removals)"
            " AND catalog_matches(title || ' ' || coalesce(artist, '') || ' ' || coalesce(album, '')"
            " || ' ' || coalesce(year, ''))"
            " ORDER BY id DESC LIMIT ?",
            (before, limit),
        ).fetchall()
        return [{"track_id": r[0], "title": r[1], "artist": r[2], "album": r[3] or "",
                 "source_url": r[4], "year": r[5] or "", "n_hashes": r[6],
                 "cover_url": cover_url(r[0])} for r in rows]
    finally:
        conn.close()


def update_track(track_id: int, title: str, artist: str, album: str, year: str) -> bool:
    conn = connect()
    try:
        with conn:
            cursor = conn.execute(
                "UPDATE tracks SET title = ?, artist = ?, album = ?, year = ?"
                " WHERE id = ? AND id NOT IN (SELECT track_id FROM catalog_removals)",
                (title, artist, album, year, track_id),
            )
            return cursor.rowcount > 0
    finally:
        conn.close()


def remove_track(track_id: int) -> bool:
    conn = connect()
    try:
        with conn:
            # Keep the track ID reserved for folder bookkeeping and saved cover URLs.
            cursor = conn.execute(
                "INSERT OR IGNORE INTO catalog_removals (track_id) SELECT id FROM tracks WHERE id = ?",
                (track_id,),
            )
            if not cursor.rowcount:
                return False
            conn.execute("DELETE FROM fingerprints WHERE track_id = ?", (track_id,))
            conn.execute("DELETE FROM speaker_fingerprints WHERE track_id = ?", (track_id,))
            conn.execute("DELETE FROM bandcamp_tracks WHERE track_id = ?", (track_id,))
        try:
            _preview_file(track_id).unlink(missing_ok=True)
        except OSError:
            logger.warning("Could not remove the audio preview for track %s", track_id)
        return True
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
