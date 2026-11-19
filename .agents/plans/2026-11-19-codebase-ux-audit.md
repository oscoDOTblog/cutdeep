# Cutdeep reliability and UX audit

## Goal

Verify the four-tab app against the local production build and fix issues encountered in recording, scan history, catalog search, and reference-track ingestion.

## Updates

| Area | Finding | Update |
| --- | --- | --- |
| Home | A pending permission request or active recording could outlive the Home tab. Matching failures were displayed as empty results. The listening animation intercepted taps on Cancel at 320 px. | Release the microphone on cancel or navigation, abort the match request when leaving, show distinct permission and matching states, and keep the animation out of the button's hit area. Request music capture with speech processing turned off. |
| Library | Removing a migrated scan left the original history entry in place, so it returned after a reload. Subtracting 24 hours could misclassify Yesterday across a daylight-saving change. | Save the removal to the current store and clear the legacy store. Use local calendar dates and describe the count as scans saved on the device. |
| Search | The Search tab was headed Library and only filtered the newest 200 tracks. Loading had no visible feedback. | Label it Search catalog. Search title, artist, and album across the full catalog, with paginated results, loading feedback, and retry. |
| File upload | The tile promised an immediate match, but choosing a file adds it as a reference. Picking a replacement could retain the previous track's details. | Label the action Upload a track, explain its catalog role, reset metadata for each selection, and show a single result after a successful upload. |
| Link import | Editing the URL could leave an old poller updating the new form. Repeated clicks could start duplicate jobs, and cancelled jobs could look queued. | Review metadata before import, use one polling loop, associate status with the submitted job, show retry and cancellation feedback, and keep cancellation available while queued or downloading. |
| Ingestion | Folder ingestion wrote a marker into a read-only mount. The API's in-memory index could miss tracks added by the separate worker. | Track folder imports transactionally in SQLite, honour existing completion markers, and refresh the API index with newly committed fingerprints. |
| Covers and jobs | An optional thumbnail failure could mark an already-ingested track as failed. Concurrent source deduplication could produce duplicate rows. | Make cover failures nonfatal, publish covers atomically, serialize source deduplication, and report the stored track's details for duplicate imports. |
| Mobile and keyboard | Amber controls used low-contrast text, metadata fields lost their labels on input, and fixed navigation could crowd narrow screens. | Improve contrast, preserve field labels and visible focus, and account for narrow viewports and bottom safe areas. |
| Quickstart | The command-line seeding example targeted an internal port. | Route the example through the web service's exposed ingest endpoint. |

## Verification

- [x] Production Next.js build passes.
- [x] Docker Compose configuration parses.
- [x] The folder worker indexes a reference once across repeated sweeps. The already-running API matches it, including a synthetic clip taken at an offset. Silent clips return no match and silent reference files are rejected.
- [x] Concurrent imports of the same source produce one track. Existing SQLite schemas migrate, and a cancelled download produces no track.
- [x] Chromium at 320 px handles microphone permission denial, cancellation, navigation away during capture, and a successful match using synthetic microphone audio.
- [x] Library persists a successful scan and keeps a removed legacy scan deleted after reload.
- [x] Search paginates, finds tracks older than the newest 200 entries, and matches album names case-insensitively with accented characters.
- [x] Upload adds audio with a cover that the web service serves as JPEG. Link import runs through yt-dlp against local HTTP audio, preserves one catalog entry for the same source, and clears finished jobs.

## Remaining coverage

The smoke test used a temporary catalog, Chromium's synthetic microphone, and a local media URL. Physical microphones, noisy venue recordings, other browsers, live provider URLs, and a rebuilt Docker Compose stack remain unverified.
