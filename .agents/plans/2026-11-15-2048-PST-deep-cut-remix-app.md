## Goal

Build a Shazam-simple web app (Next.js first, mobile later) that identifies deep-cut remixes / battle edits heard at dance battles, where mainstream Shazam returns no match or the wrong original.

Non-goal for v1: out-Shazam Shazam on mainstream songs, full-song streaming, stem separation, custom model training.

## Success Criteria

- Record 5–10s of noisy room audio in the browser, get remix-level candidates in <5s.
- Indexed catalog starts with local scene staples (1k–10k tracks), not "all remixes".
- When no exact match exists, return near-matches + "submit link" fallback.
- Same API serves web v1 and a later mobile app with no rework.
- Runs locally for $0 extra; single-host Docker Compose path defined before any cloud spend.
- Store fingerprints + metadata + external links; do not host full remix files publicly without rights.

## Approach

### Why Shazam misses these

Shazam matches snippets against officially distributed recordings. Battle deep cuts often live only as SoundCloud uploads, DJ edits, YouTube rips, private files, or low-quality battle recordings, so they are not in that index. Remixes also share vocals/drums/bass with the original, so a naive fingerprint can collapse to the original instead of the specific edit.

### How Shazam-style matching works (what we replicate)

1. Record short clip (5–10s mic audio via browser MediaRecorder).
2. Spectrogram via Short-Time Fourier Transform (frequency over time).
3. Pick prominent spectral peaks robust to noise, EQ, compression, phone-speaker distortion.
4. Hash peak pairs (freq1 + freq2 + delta-time) so match is offset-independent.
5. Inverted index lookup: `hash -> track ID + timestamp`.
6. Vote on time offsets; real match = many hashes agree on one offset.
7. Return highest consistent vote count.

Use two layers for remixes:

- Exact layer (Dejavu-style landmark hashes): same file / clean recording resolves to specific remix.
- Similarity layer (Chromaprint-style chroma features): pitched, re-EQ'd, cut, or noisy versions group to "sounds like" candidates. Chromaprint resamples to 11025 Hz, uses 4096-sample frames with overlap, maps to 12 chroma bins, then compresses windowed filter responses to 32-bit sub-fingerprints.

Result UX is honest ranking, not single answer:

```text
Possible matches
1. "Song X — DJ ____ Bootleg" — 82%
2. Original track — vocal segment matched
3. "Song X — Extended Edit" — 61%
Not right? Add SoundCloud / YouTube link.
```

### Recommended architecture (Next.js web first, local-first)

```text
Browser (Next.js)
  MediaRecorder 10s clip -> POST /api/identify
    |
Next.js server routes (node:20-slim)
  /api/identify -> forwards audio to fingerprint service
  /api/submit, /api/search -> metadata DB
  pages: record, results, history, submit-link
    |
FastAPI fingerprint service (python:3.12-slim + ffmpeg)
  decode/resample -> fingerprint clip
  -> exact search -> near-match search -> candidates + links
    |
SQLite (WAL mode) for metadata v1; Postgres later if joins/moderation demand it
Fingerprint index on local SSD (audfprint files); worker ingests authorized audio
Volumes for db, index snapshots, temp clips (no S3 required for v1)
```

Key decisions:

- Frontend: Next.js for v1. Later mobile (Expo/native) reuses the same `/identify`, `/submit`, `/search` API.
- Fingerprinting stays in Python (evaluate audfprint first; exposes density/index config). No in-browser fingerprinting for v1.
- Metadata default: SQLite WAL for local/cheap hosting. Move to Postgres only when relational load proves it.
- Fingerprint postings live in a compact purpose-built index on disk, not in SQLite/Postgres/Mongo rows.
- Ingestion: user clip ("heard at battle") + known remix link (SoundCloud/YouTube/Bandcamp/file) + community confirm ("yes, this clip = this link").
- Legal default: fingerprints + metadata + outbound links. No public full-file hosting. Add takedown/repeat-infringer process if UGC uploads ship.

### Docker Compose deployment (local-first)

Services: `web` (Next.js), `fp-api` (FastAPI), `worker` (ingestion), shared named volumes for `db`, `index`, `tmp-clips`. Compose profiles or a second file adds a small VPS target later; no Kubernetes, managed DB, or S3 for v1.

```yaml
services:
  web:
    build: ./web
    ports: ["3000:3000"]
    environment:
      FP_API_URL: http://fp-api:8000
      DB_PATH: /data/meta.db
    volumes: ["db:/data", "tmp-clips:/tmp/clips"]
  fp-api:
    build: ./fp-api
    volumes: ["index:/index", "tmp-clips:/tmp/clips"]
  worker:
    build: ./fp-api
    command: ["python", "worker.py"]
    volumes: ["db:/data", "index:/index", "music:/music:ro"]
volumes: { db: {}, index: {}, tmp-clips: {}, music: {} }
```

Phone testing locally: same LAN or Tailscale to the laptop host. Cloud move is a lift-and-shift of this Compose file to one small host.

## Steps

### 0. Seed + scope (weekend 0)

- Collect 50–100 known battle remixes you own. List scene staples first.
- Decide private tool vs community beta vs public UGC (changes legal/scale work).

### 1. CLI fingerprint spike (1–2 weekends)

- Fingerprint local MP3s. Record battle clips / battle videos via phone.
- Measure: correct-remix vs original-song rate, no-match/false-match rate, speed-shift behavior, bytes/track, latency/RAM.
- Add near-match mode (original + remix candidates).

### 2. FP service + Compose (1–2 weekends)

- FastAPI: `POST /identify`, `POST /submit`, `GET /search` (internal).
- SQLite WAL metadata. Fingerprint index on `index` volume. Worker for full-track ingestion.
- `docker compose up --build`; snapshot/restore index from volume.

### 3. Next.js web v1 (2–3 weekends)

- Record button (MediaRecorder), results screen, history, "add remix link" flow.
- `/api/*` routes proxy to fp-api + SQLite. URL import for SoundCloud/YouTube, dedupe, metadata cleanup.

### 4. Catalog + community (2–4 weekends)

- Submissions, voting/confirmation, moderation, search.
- Seed 1k–10k, then 10k–100k only if accuracy holds.

### 5. Mobile + hardening (later)

- Expo/native client against the same API. Noise testing, abuse controls, licensing review, monitoring, backup/restore.
- 1M-track beta only after local experiment proves density/latency/RAM.

Effort guide:

- Personal tool (own collection): 1–2 weekends.
- Dance-community web app: 4–8 weekends.
- Public large-catalog UGC app: 3–6+ months (mostly moderation, catalog quality, rights, infra).

## Validation Plan

- Fingerprint gate: 1,000 known remixes, 100 real phone recordings. Report correct/false/no-match rates, speed-shift tolerance, index bytes/track, p95 latency, peak RAM.
- Compose gate: cold `docker compose up --build` on a fresh checkout identifies a 10s clip end-to-end; index snapshot restores and recall is unchanged.
- Web gate: browser record-to-result <5s on venue WiFi; history persists; link submission creates moderation item; unknown clip shows near-matches + submit prompt.
- Scale gate: rebuild index snapshot, restore on fresh host, verify recall unchanged. This decides if a $200–$400/mo single-server plan is viable.

## Costs (planning budgets, single-region beta)

V1 local: $0 extra (laptop + local SSD). Phone testing over LAN/Tailscale.

Later scale reference (1M tracks x ~4 min, 100k identifies/mo, 10s clips, no full-song streaming, authorized reference audio):

Fingerprint sizing (illustrative, compact index):

- 7 hashes/sec x 240s = ~1,680/track = ~1.68B postings / 1M tracks = ~20–27 GB at 12–16 B/posting.
- 20 hashes/sec x 240s = ~4,800/track = ~4.8B postings / 1M = ~58–77 GB.
- Reserve 100–250 GB live index + 10–30 GB metadata/headroom + rebuild/snapshot space.

Monthly (only if/when leaving local):

- Lean beta: ~$200–$320 (e.g. 32 GB RAM / 8 vCPU / 640 GB SSD single server ~$164 + $10–$30 backups + $5–$25 logs/DNS + $20–$100 ingestion contingency). Round to $200–$400.
- Resilient public: ~$400–$800 (second recognizer, safer metadata, traffic distribution, update headroom).
- Keep full compressed catalog: +$125–$220/mo for 1M tracks. Discard-after-fingerprinting keeps this near zero but requires re-acquirable authorized audio for re-fingerprinting.

Spend stages: local ($0) -> community beta 10k–100k ($50–$150) -> 1M beta ($200–$400) -> resilient ($400–$800). Reserve ~$300/mo for 1M beta planning + separate unpriced budget for catalog rights and dev time.

## Risks / Open Questions

- Catalog is ~70% of the work. Matching is the easier ~30%.
- Unindexed remix discovery is unsolved by fingerprinting alone; needs community submission loop.
- Remix-vs-original disambiguation needs near-match UX + human confirmation.
- Rights: fingerprinting is not the risk; redistributing remixes is. Link out by default.
- Single-host Compose has no failover; ingestion can contend with queries (separate worker first).
- Open: SQLite WAL ceiling vs Postgres move point? Expo vs native for the later app? Retain reference audio for re-fingerprinting or discard to save cost?

## Sources

- Chromaprint algorithm (resampling, STFT frames, 12-bin chroma, 32-bit sub-fingerprints): https://blog.acoustid.org/posts/how-does-chromaprint-work/
