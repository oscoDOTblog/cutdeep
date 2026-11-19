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

## How it works

Record 10s in the browser → Next.js forwards the clip to `fp-api` →
landmark fingerprint (spectrogram peaks → peak-pair hashes → offset voting)
→ ranked remix candidates. Confident matches are saved in the device's Library.

## Layout

- `web/` — Next.js recording, library, catalog search, and upload UI with `/api/*` proxy routes
- `fp-api/` — FastAPI fingerprint service, SQLite metadata, worker
- `music/` — drop reference tracks here (git-ignored)
