# Auto-add tracks through the Cutdeep API

## Goal

Let an automated caller add a reference track from a URL or an audio file, then check when it is searchable in the catalog and available to Scan.

Cutdeep already accepts files at `POST /api/ingest` and URLs at `POST /api/link/import`. Keep both routes available for existing callers and reuse their ingestion code.

## API

- `POST /api/catalog/imports` accepts JSON with a `url` or multipart form data with a `file`. Either form can include a title, artist, album, and release year. Return `202 Accepted` with an `import_id` and a status URL.
- `GET /api/catalog/imports/{id}` reports the status as `queued`, `processing`, `ready`, or `failed`. A ready response includes the `track_id` and whether the import reused an existing track. A failed response includes an error the caller can act on.

## Implementation

1. Store import jobs in SQLite so callers can continue checking them after a restart. Stage uploaded files until the worker has indexed them and clean up staged files after processing.
2. Route URL jobs through the existing link importer and file jobs through the existing file ingestion code. Mark a job ready after the track and its fingerprints are committed.
3. Deduplicate URL imports by normalized provider URL and file imports by file hash. Handle concurrent retries so repeat imports return the existing track ID.

## Verification

- Import one supported URL and one audio file. Confirm both appear in Catalog Search and can be recognized by Scan once the API reports them ready.
- Submit the same URL and file again, including concurrent retries. Confirm each response resolves to the same track ID.
- Restart the service with an import pending and verify the status endpoint can still track it. Submit an invalid URL and an unsupported file and check that each failure is visible to the caller.
