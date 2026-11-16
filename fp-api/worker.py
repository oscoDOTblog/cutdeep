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
    store.connect().close()
    if not MUSIC_DIR.is_dir():
        return
    for path in sorted(MUSIC_DIR.iterdir()):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTS:
            continue
        done = path.with_suffix(path.suffix + ".done")
        if done.exists():
            continue
        try:
            res = store.ingest_file(path, title=path.stem)
            print(f"ingested {path.name}: {res['n_hashes']} hashes", flush=True)
        except Exception as e:  # noqa: BLE001 - keep worker alive on bad files
            print(f"skip {path.name}: {e}", flush=True)
            continue
        done.touch()


if __name__ == "__main__":
    store.rebuild_index()
    while True:
        sweep()
        time.sleep(POLL_SECS)
