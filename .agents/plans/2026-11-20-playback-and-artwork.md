# CutDeep playback and artwork for linked tracks

November 20, 2026

CutDeep identifies tracks from fingerprints. A track imported from a provider can also carry its original playback link and a provider-hosted artwork URL. File-only tracks still work in Search and Scan.

## Playback and discovery

- Save the source URL provided by link ingestion. Show **Open track** on linked Scan results and open the source in a new tab.
- Keep in-page playback available on likely matches with a supported provider embed. YouTube Music links can use YouTube’s player when playback is permitted. SoundCloud and Bandcamp have their own players.
- Leave playback controls off Scan results without a source. Search links built from the artist and full title were discussed as a discovery feature. Keep the Scan action tied to the exact recording that was imported so a result points to the right remix.
- SoundCloud and Bandcamp are useful places to find edits, independent label releases, and reissues. Mixcloud and HearThis.at can supply DJ sets. Beatport and Traxsource are useful for finding specific club mixes, while Discogs and NTS help trace pressings and tracklists. The auto-add API accepts individual public YouTube, SoundCloud, and Bandcamp track URLs.

## Catalog storage

- Stage audio for fingerprinting, then discard it after processing. Keep the fingerprints, track metadata, and file digest used for deduplication.
- When the link extractor returns a usable artwork URL, save it with the track and render it on the site. Load the image from the provider and show the default track tile when artwork is missing or unavailable.
- Retire hosted MP3 previews and cover uploads and stop serving the old media routes. Previously stored media remains on disk unless explicitly deleted.

## Verification

- Import a file and a provider link. Confirm both are searchable and can be identified after indexing. Confirm there are no new local preview or cover files.
- Verify the artwork URL is returned by Scan and Search. Check that the image renders in the browser and that the card falls back to the default tile if the image fails.
- Check that **Open track** opens the supplied source in a new tab, and that a scan without a source shows the match without playback controls.
