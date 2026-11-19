"""Background ingestion worker: fingerprints new files dropped in /music."""
from __future__ import annotations

import os
import time
from pathlib import Path

import store

MUSIC_DIR = Path(os.environ.get("MUSIC_DIR", "/music"))
POLL_SECS = int(os.environ.get("POLL_SECS", "30"))
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".opus", ".wma", ".aif", ".aiff"}


def sweep() -> None:
    if not MUSIC_DIR.is_dir():
        return
    conn = store.connect()
    try:
        imported = {row[0] for row in conn.execute("SELECT path FROM folder_imports")}
    finally:
        conn.close()
    for path in sorted(MUSIC_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTS:
            continue
        done = path.with_suffix(path.suffix + ".done")
        if path.name in imported or done.exists():
            continue
        try:
            res = store.ingest_file(path, title=path.stem, folder_path=path.name)
            print(f"ingested {path.name}: {res['n_hashes']} hashes", flush=True)
        except Exception as e:  # noqa: BLE001 - keep worker alive on bad files
            print(f"skip {path.name}: {e}", flush=True)


if __name__ == "__main__":
    while True:
        sweep()
        time.sleep(POLL_SECS)
