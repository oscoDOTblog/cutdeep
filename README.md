# cutdeep
Shazam for club remix bangers — name that battle remix, not the original.

## Quickstart (local, $0)

```sh
docker compose up --build
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Seed the catalog

Drop reference MP3/WAVs into `music/` — the worker fingerprints them
automatically (about 30s poll). Or POST to the fingerprint service:

```sh
curl -F "file=@remix.mp3" -F "title=Song X — DJ Y Bootleg" \
  -F "source_url=https://soundcloud.com/..." \
  http://localhost:8000/ingest
```

Note: `fp-api` is not port-mapped in compose; use the web UI or
`docker compose exec fp-api` for direct API access.

## How it works

Record 10s in the browser → Next.js forwards the clip to `fp-api` →
landmark fingerprint (spectrogram peaks → peak-pair hashes → offset voting)
→ ranked remix candidates plus a submit-link fallback.

## Layout

- `web/` — Next.js record/results/submit UI + `/api/*` proxy routes
- `fp-api/` — FastAPI fingerprint service, SQLite metadata, worker
- `music/` — drop reference tracks here (git-ignored)
