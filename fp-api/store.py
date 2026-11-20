"""SQLite metadata + fingerprint storage with in-memory inverted index."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import sqlite3
import threading
import time
from collections import Counter, defaultdict
from pathlib import Path

from fingerprint import SPEAKER_HOP, SR, decode_mono, fingerprint_hashes, speaker_hashes
from source_urls import canonical_track_url, public_web_url

DB_PATH = os.environ.get("DB_PATH", "/data/meta.db")
PREVIEW_DIR = Path(DB_PATH).with_name("previews")
logger = logging.getLogger(__name__)


SCHEMA = """
CREATE TABLE IF NOT EXISTS tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  artist TEXT DEFAULT '',
  album TEXT DEFAULT '',
  source_url TEXT DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
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
CREATE TABLE IF NOT EXISTS track_file_hashes (
  track_id INTEGER NOT NULL REFERENCES tracks(id),
  sha256 TEXT NOT NULL,
  PRIMARY KEY (track_id, sha256)
);
CREATE INDEX IF NOT EXISTS track_file_hash_sha256 ON track_file_hashes(sha256);
CREATE TABLE IF NOT EXISTS catalog_imports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('url', 'file')),
  source TEXT NOT NULL,
  details TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'ready', 'failed')),
  created_at REAL NOT NULL,
  track_id INTEGER REFERENCES tracks(id),
  deduped INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS catalog_import_source ON catalog_imports(kind, source, created_at);
CREATE INDEX IF NOT EXISTS catalog_import_queue ON catalog_imports(status, created_at);
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
    metadata_columns = ("year", "album", "cover_url")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(tracks)")}
    if not cols.issuperset(metadata_columns):
        with conn:
            conn.execute("BEGIN IMMEDIATE")
            cols = {r[1] for r in conn.execute("PRAGMA table_info(tracks)")}
            for col in metadata_columns:
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


def _find_source(conn: sqlite3.Connection, url: str) -> tuple[int] | None:
    conn.create_function("canonical_track_url", 1, canonical_track_url, deterministic=True)
    return conn.execute(
        "SELECT t.id FROM tracks t JOIN fingerprints f ON f.track_id = t.id"
        " WHERE t.source_url != '' AND canonical_track_url(t.source_url) = ?"
        " ORDER BY t.id LIMIT 1",
        (url,),
    ).fetchone()


def find_source_track(url: str) -> int | None:
    conn = connect()
    try:
        found = _find_source(conn, url)
        return found[0] if found else None
    finally:
        conn.close()


def _find_file(conn: sqlite3.Connection, sha256: str, legacy_blob: str,
               speaker_blob: str) -> tuple[int] | None:
    known = conn.execute(
        "SELECT h.track_id FROM track_file_hashes h JOIN fingerprints f ON f.track_id = h.track_id"
        " WHERE h.sha256 = ? ORDER BY h.track_id LIMIT 1",
        (sha256,),
    ).fetchone()
    if known:
        return known
    # Older file imports have no byte digest. Reuse an exact stored audio
    # fingerprint, including speaker landmarks when the reference has them.
    return conn.execute(
        "SELECT f.track_id FROM fingerprints f JOIN tracks t ON t.id = f.track_id"
        " LEFT JOIN speaker_fingerprints s ON s.track_id = f.track_id"
        " LEFT JOIN track_file_hashes h ON h.track_id = f.track_id"
        " WHERE t.source_url = '' AND h.track_id IS NULL AND f.hashes = ?"
        " AND (s.hashes IS NULL OR s.hashes = ?) ORDER BY f.track_id LIMIT 1",
        (legacy_blob, speaker_blob),
    ).fetchone()


def ingest_file(path: str | Path, title: str, artist: str = "", album: str = "",
                source_url: str = "", year: str = "", folder_path: str = "",
                downloaded_from_source: bool = False, bandcamp_track_id: str = "",
                *, cover_url: str = "", file_sha256: str = "", canonical_source: bool = False) -> dict:
    source_url = public_web_url(source_url)
    cover_url = public_web_url(cover_url) if downloaded_from_source else ""
    samples = decode_mono(path, uploaded=bool(file_sha256))
    hashes = fingerprint_hashes(samples)
    speaker = speaker_hashes(samples)
    if not hashes:
        raise ValueError("no fingerprints extracted — unsupported or silent audio")
    legacy_blob = json.dumps(hashes)
    speaker_blob = json.dumps(speaker)
    digest = file_sha256
    if not (downloaded_from_source or digest):
        with open(path, "rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
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
        if canonical_source:
            duplicate = _find_source(conn, source_url)
        elif file_sha256:
            duplicate = _find_file(conn, file_sha256, legacy_blob, speaker_blob)
        elif source_url or folder_path:
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
            if cover_url:
                conn.execute("UPDATE tracks SET cover_url = ? WHERE id = ?", (cover_url, track_id))
            row = conn.execute(
                "SELECT title, artist, album, source_url, year, n_hashes, cover_url FROM tracks WHERE id = ?",
                (track_id,),
            ).fetchone()
            result = {"track_id": track_id, "title": row[0], "artist": row[1],
                      "album": row[2] or "", "source_url": row[3], "year": row[4] or "",
                      "n_hashes": row[5], "cover_url": row[6] or "", "deduped": True}
        else:
            cur = conn.execute(
                "INSERT INTO tracks (title, artist, album, source_url, year, n_hashes, created_at, cover_url)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (title, artist, album, source_url, year, len(hashes), time.time(), cover_url),
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
                      "source_url": source_url, "year": year, "cover_url": cover_url,
                      "n_hashes": len(hashes) + len(speaker), "deduped": False}
        if re.fullmatch(r"[0-9]+", bandcamp_track_id):
            conn.execute(
                "INSERT OR IGNORE INTO bandcamp_tracks (track_id, provider_id) VALUES (?, ?)",
                (track_id, bandcamp_track_id),
            )
        if digest and (not duplicate or not (source_url or folder_path)):
            conn.execute(
                "INSERT OR IGNORE INTO track_file_hashes (track_id, sha256) VALUES (?, ?)",
                (track_id, digest),
            )
        conn.commit()
    finally:
        conn.close()
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
                "SELECT id, title, artist, album, source_url, year, cover_url FROM tracks WHERE id=?",
                (track_id,),
            ).fetchone()
            if row:
                out.append({"track_id": row[0], "title": row[1], "artist": row[2],
                            "album": row[3] or "", "source_url": public_web_url(row[4]),
                            "year": row[5] or "", "votes": votes,
                            "confidence": round(conf, 3), "cover_url": row[6] or ""})
        if out:
            top = out[0]
            top["match_status"] = _match_status(conn, top, scored, used_speaker)
            if top["source_url"] and top["match_status"] == "likely":
                bandcamp = conn.execute(
                    "SELECT provider_id FROM bandcamp_tracks WHERE track_id = ?", (top["track_id"],),
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
            "SELECT id, title, artist, album, source_url, year, n_hashes, cover_url FROM tracks "
            "WHERE id < coalesce(?, 9223372036854775807)"
            " AND id NOT IN (SELECT track_id FROM catalog_removals)"
            " AND catalog_matches(title || ' ' || coalesce(artist, '') || ' ' || coalesce(album, '')"
            " || ' ' || coalesce(year, ''))"
            " ORDER BY id DESC LIMIT ?",
            (before, limit),
        ).fetchall()
        return [{"track_id": r[0], "title": r[1], "artist": r[2], "album": r[3] or "",
                 "source_url": public_web_url(r[4]), "year": r[5] or "", "n_hashes": r[6],
                 "cover_url": r[7] or ""} for r in rows]
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
            # Keep the track ID reserved for folder bookkeeping.
            cursor = conn.execute(
                "INSERT OR IGNORE INTO catalog_removals (track_id) SELECT id FROM tracks WHERE id = ?",
                (track_id,),
            )
            if not cursor.rowcount:
                return False
            conn.execute("DELETE FROM fingerprints WHERE track_id = ?", (track_id,))
            conn.execute("DELETE FROM speaker_fingerprints WHERE track_id = ?", (track_id,))
            conn.execute("DELETE FROM bandcamp_tracks WHERE track_id = ?", (track_id,))
            conn.execute("DELETE FROM track_file_hashes WHERE track_id = ?", (track_id,))
        try:
            (PREVIEW_DIR / f"{track_id}.mp3").unlink(missing_ok=True)
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
