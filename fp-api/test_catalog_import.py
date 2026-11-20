"""Run with `python -m unittest discover -s fp-api -p 'test_*.py'`."""
from __future__ import annotations

import io
import tempfile
import threading
import time
import unittest
import wave
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import numpy as np

import catalog_import
import store
from fingerprint import SR, decode_mono, fingerprint_hashes, speaker_hashes
from source_urls import canonical_track_url


class CatalogImportTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        self.enterContext(patch.multiple(
            store, DB_PATH=str(root / "catalog.db"), PREVIEW_DIR=root / "previews",
        ))
        self.spool = root / "imports"
        self.enterContext(patch.object(catalog_import, "SPOOL", self.spool))

        reference = root / "reference.wav"
        t = np.arange(SR * 8) / SR
        signal = np.sin(2 * np.pi * (120 * t + 20 * t ** 2)) * (1 + np.sin(10 * t))
        signal += np.sin(2 * np.pi * (200 * t + 43 * t ** 2))
        with wave.open(str(reference), "wb") as wav:
            wav.setparams((1, 2, SR, 0, "NONE", "not compressed"))
            wav.writeframes((signal * 9000).astype("<i2").tobytes())
        self.reference = reference
        self.audio = reference.read_bytes()

    def test_concurrent_files_reuse_job_and_interrupted_processing_resumes(self):
        def submit(n):
            return catalog_import.queue_file(io.BytesIO(self.audio), {"title": f"Fixture {n}"})

        with ThreadPoolExecutor(max_workers=6) as pool:
            jobs = list(pool.map(submit, range(6)))
        job_id = jobs[0]["import_id"]
        self.assertEqual({job["import_id"] for job in jobs}, {job_id})
        self.assertEqual(sum(not job["reused_import"] for job in jobs), 1)
        self.assertEqual(len(list(self.spool.glob("*.audio"))), 1)
        self.assertEqual(catalog_import._claim()["id"], job_id)
        self.assertEqual(catalog_import.get_import(job_id)["status"], "processing")

        # Simulate a process stopping after taking the job. The new worker
        # can see both the processing row and the staged reference.
        stop = threading.Event()
        worker = threading.Thread(target=catalog_import.run_worker, args=(stop,))
        worker.start()
        try:
            deadline = time.monotonic() + 10
            while catalog_import.get_import(job_id)["status"] == "processing" and time.monotonic() < deadline:
                time.sleep(0.05)
        finally:
            stop.set()
            worker.join(timeout=10)
        job = catalog_import.get_import(job_id)
        self.assertEqual(job["status"], "ready")
        self.assertFalse(job["deduped"])
        self.assertEqual(list(self.spool.glob("*.audio")), [])
        self.assertFalse(store.PREVIEW_DIR.exists())
        self.assertEqual(submit(10)["track_id"], job["track_id"])
        self.assertEqual(store.search_tracks("Fixture")[0]["track_id"], job["track_id"])
        store.rebuild_index()
        samples = decode_mono(self.reference)
        match = store.match(fingerprint_hashes(samples), speaker=speaker_hashes(samples))[0]
        self.assertEqual(match["track_id"], job["track_id"])
        self.assertEqual(match["source_url"], "")
        self.assertEqual(match["cover_url"], "")
        self.assertNotIn("preview_url", match)

    def test_link_import_keeps_provider_artwork_and_playback_urls(self):
        url = "https://pressing.bandcamp.com/track/original-mix"
        artwork = "https://f4.bcbits.com/img/a1234567890_10.jpg"
        job = catalog_import.queue_url(url, {})
        with patch("yt_dlp.YoutubeDL") as downloader:
            extractor = downloader.return_value.__enter__.return_value

            def extract_info(track_url, *, download):
                self.assertTrue(download)
                self.assertEqual(track_url, url)
                output = downloader.call_args.args[0]["outtmpl"].replace("%(ext)s", "wav")
                Path(output).write_bytes(self.audio)
                return {"title": "Original Mix", "artist": "DJ", "thumbnail": artwork,
                        "id": "1234567890", "extractor_key": "Bandcamp"}

            extractor.extract_info.side_effect = extract_info
            catalog_import._process(catalog_import._claim())

        result = catalog_import.get_import(job["import_id"])
        self.assertEqual(result["status"], "ready")
        self.assertFalse(Path(downloader.call_args.args[0]["outtmpl"]).parent.exists())
        self.assertFalse(store.PREVIEW_DIR.exists())
        track = store.search_tracks("Original Mix")[0]
        self.assertEqual(track["source_url"], url)
        self.assertEqual(track["cover_url"], artwork)
        store.rebuild_index()
        samples = decode_mono(self.reference)
        match = store.match(fingerprint_hashes(samples), speaker=speaker_hashes(samples))[0]
        self.assertEqual(match["source_url"], url)
        self.assertEqual(match["cover_url"], artwork)
        self.assertEqual(match["bandcamp_track_id"], "1234567890")
        self.assertNotIn("preview_url", match)

    def test_file_reuses_reference_uploaded_through_the_original_path(self):
        original = store.ingest_file(self.reference, "Original title")
        job = catalog_import.queue_file(io.BytesIO(self.audio), {"title": "New title"})
        catalog_import._process(catalog_import._claim())
        result = catalog_import.get_import(job["import_id"])
        self.assertEqual(result["track_id"], original["track_id"])
        self.assertTrue(result["deduped"])
        self.assertEqual(len(store.search_tracks("")), 1)

    def test_url_variants_reuse_existing_reference_without_downloading(self):
        original = store.ingest_file(
            self.reference, "URL title", source_url="https://music.youtube.com/watch?v=6bf6pjiYX98",
            downloaded_from_source=True,
        )
        url = canonical_track_url("https://youtu.be/6bf6pjiYX98?si=share")
        job = catalog_import.queue_url(url, {})
        with patch("link_import.import_track") as download:
            catalog_import._process(catalog_import._claim())
            download.assert_not_called()
        result = catalog_import.get_import(job["import_id"])
        self.assertEqual(result["track_id"], original["track_id"])
        self.assertTrue(result["deduped"])
        self.assertIsNone(canonical_track_url("https://youtube.com.example.org/watch?v=6bf6pjiYX98"))
        self.assertIsNone(canonical_track_url("https://youtube.com/playlist?list=6bf6pjiYX98"))
        self.assertEqual(canonical_track_url("https://m.soundcloud.com/Forss/Flickermood/?utm_source=share"),
                         "https://soundcloud.com/forss/flickermood")

    def test_unsupported_file_fails_and_staged_bytes_are_removed(self):
        with self.assertLogs(catalog_import.logger, level="ERROR"):
            queued = catalog_import.queue_file(io.BytesIO(b"not an audio file"), {"title": "Bad input"})
            catalog_import._process(catalog_import._claim())
        job = catalog_import.get_import(queued["import_id"])
        self.assertEqual(job["status"], "failed")
        self.assertIn("audio", job["error"])
        self.assertEqual(list(self.spool.glob("*.audio")), [])
        self.assertEqual(store.search_tracks(""), [])
