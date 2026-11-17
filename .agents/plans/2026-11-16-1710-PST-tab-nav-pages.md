## Goal

Split the single-page web app into four tabbed pages modeled on the
`docs/refs` Shazam screenshots, keeping the SAO theme: home (record button
that becomes a listening animation), library (successfully scanned songs),
search (catalog lookup), upload (clip file + submit-link form).

Non-goals: song-detail page (`song-info.PNG` stays a follow-up), artwork
images, playback, accounts/sync.

## Success Criteria

- `/` shows an idle round ◆ button; tapping it swaps to a listening state
  (expanding rings, elapsed seconds, X to cancel), then matching, then the
  top result with a source link.
- `/library` lists past successful scans grouped by day with counts.
- `/search` queries the indexed catalog and links out to sources.
- `/upload` keeps the existing file-upload and submit-link flows working.
- Bottom tab bar (Home / Library / Search / Upload) on all pages.
- `npm run build` passes; identify flow still works end to end.

## Approach

Layout follows the refs; styling stays SAO (charcoal, amber, ◆, HUD caps,
clipped panels, HP-bar confidence). No Shazam logo or artwork is copied;
result tiles use an amber ◆ placeholder.

### Routes

```text
/           home: big button -> listening rings -> LinkStart -> top result
/library    successful scans, grouped Today / Yesterday / Earlier + count
/search     input + button -> GET /api/search -> rows with source links
/upload     file picker card + submit-link form (moved as-is)
```

Shared client code in `web/app/lib/scans.ts`: scan record
`{ts, title, artist, sourceUrl, conf, votes}`, load/save/clear, tolerant
parse that also accepts the old `{top, conf}` history shape. Shared
`web/app/components/` pieces: `TabBar`, `LinkStart`, `ResultCard`
(◆ tile, title, artist, HP bar, source link).

### State changes

- Home owns recording + matching; on a confident match it writes one scan
  record via `scans.ts`. No-match results are not stored (library is
  successes only).
- Library/search/upload are separate client pages; search/upload reuse the
  existing `/api/search`, `/api/identify`, `/api/submit` proxies unchanged.
- Tab bar is a fixed bottom nav in `layout.tsx`; pages get bottom padding.
  Active tab is a filled amber pill per the SAO switcher motif.

## Steps

1. Add `lib/scans.ts` + `components/TabBar.tsx`, `LinkStart.tsx`,
   `ResultCard.tsx`; extend `globals.css` (tab bar, listening rings,
   result rows, search field).
2. Rewrite `/` as home: idle button, listening rings + cancel, matching
   loader, top-result card; record scan on match.
3. Build `/library` reading `scans.ts`, grouped with headers and counts.
4. Build `/search` with input, loading, results, empty state.
5. Move upload + submit form to `/upload`; home keeps no upload UI.
6. Wire tab bar into `layout.tsx`; remove old single-page sections.

## Validation Plan

- `npm run build` passes with no type errors.
- `docker compose up`: each route returns 200; record/upload/identify
  through `/` and `/upload` still match the seeded track.
- Manual: cancel mid-listen returns to idle; reload keeps library;
  legacy localStorage history does not crash library.

## Risks / Open Questions

- Library is device-local (localStorage). Server accounts/sync is a later
  step; this matches the local-first plan.
- Mic permission denial must land back on idle with the upload hint.
- No artwork service exists; ◆ tiles stand in until source thumbnails do.
- `song-info.PNG` detail view is out of scope; top result links straight
  to the external source for now.

## Sources

- Layout refs inspected in this repo: `docs/refs/home-main.PNG`,
  `docs/refs/home-listen.PNG`, `docs/refs/library.PNG`,
  `docs/refs/search.PNG`, `docs/refs/song-info.PNG`.
- Theme: `.agents/skills/sao-ux-web/SKILL.md` (already applied).
