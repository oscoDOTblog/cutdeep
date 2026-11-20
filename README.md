# cutdeep
Shazam for club remix bangers — name that battle remix, not the original.

## Quickstart (local, $0)

```sh
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Seed the catalog

Open Upload to import a link or add a reference audio file. You can also drop
reference MP3/WAVs into `music/`. The worker checks the folder every 30 seconds.
To seed the catalog from the command line, use the web API:

```sh
curl -F "file=@remix.mp3" -F "title=Song X — DJ Y Bootleg" \
  -F "source_url=https://soundcloud.com/..." \
  http://localhost:3000/api/ingest
```

### Auto-add API

Submit a file or a public YouTube, SoundCloud, or Bandcamp track URL. Both
requests return HTTP `202` with an `import_id` and a `status_url`.

```sh
curl -F "file=@remix.mp3" -F "title=Song X — DJ Y Bootleg" \
  http://localhost:3000/api/catalog/imports

curl -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=VIDEO_ID"}' \
  http://localhost:3000/api/catalog/imports
```

Poll the returned `status_url` until it reports `ready` or `failed`.
A ready import includes the `track_id` now available in Search and Scan.
A failure includes an `error` message. The optional metadata fields are
`title`, `artist`, `album`, and `year`. Audio uploads default to a 256 MiB limit.

Repeated submissions of the same normalized URL or file bytes reuse the
active import and return `reused_import: true`. A ready job also reports
whether its run reused an existing catalog track in `deduped`.

## How it works

Record 10s in the browser → Next.js forwards the clip to `fp-api` →
landmark fingerprint (spectrogram peaks → peak-pair hashes → offset voting)
→ ranked remix candidates. Confident matches are saved in the device's Library.

## Layout

- `web/` — Next.js recording, library, catalog search, and upload UI with `/api/*` proxy routes
- `fp-api/` — FastAPI fingerprint service, SQLite metadata, worker
- `music/` — drop reference tracks here (git-ignored)
