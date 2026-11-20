"use client";

import { useEffect, useRef, useState } from "react";
import ResultCard from "./ResultCard";
import TrackEditor from "./TrackEditor";
import { readJson } from "../lib/api";
import type { Candidate } from "../lib/scans";

function CatalogResults({ query, manage, onChanged }: {
  query: string;
  manage: boolean;
  onChanged: (message: string) => void;
}) {
  const [results, setResults] = useState<Candidate[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [before, setBefore] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, limit: "30" });
    if (before !== null) params.set("before", String(before));
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal });
        const { ok, data } = await readJson(res);
        if (!ok) throw new Error("Catalog request failed");
        if (controller.signal.aborted) return;
        setResults((previous) => before === null ? data.results : [...previous, ...data.results]);
        setNext(data.next_before);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, before === null && query ? 200 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, before, attempt]);

  const [action, setAction] = useState<{ track: Candidate; kind: "edit" | "remove" } | null>(null);

  return (
    <>
      {loading && <p className="status" role="status">{query ? "Searching catalog…" : "Loading catalog…"}</p>}
      {error && <p className="err" role="alert">Could not load the catalog.</p>}
      {!loading && !error && results.length === 0 && (
        <p className="empty" role="status">
          {query ? "No tracks match your search." : "Add tracks from the Upload tab to start your catalog."}
        </p>
      )}
      {results.length > 0 && (
        <p className="status" role="status">Showing {results.length} track{results.length === 1 ? "" : "s"}</p>
      )}
      <div className={manage ? "scan-list" : undefined}>
        {results.map((c) => (
          <div className={manage ? "manage-track-row" : undefined} key={c.track_id}>
            <ResultCard
              title={c.title}
              artist={c.artist}
              album={c.album}
              sourceUrl={c.source_url}
              conf={c.confidence ?? 1}
              votes={c.votes ?? 0}
              year={c.year}
              coverUrl={c.cover_url}
              stats={`${c.n_hashes ?? 0} landmarks indexed`}
            />
            {manage && (
              <div className="scan-actions">
                <button type="button" aria-label={`Edit details for ${c.title}`} onClick={() => setAction({ track: c, kind: "edit" })}>Edit</button>
                <button type="button" className="scan-remove" aria-label={`Remove ${c.title} from catalog`} onClick={() => setAction({ track: c, kind: "remove" })}>Remove</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {action && <TrackEditor {...action} onClose={() => setAction(null)} onChanged={onChanged} />}
      {!loading && (error || next !== null) && (
        <button type="button" className="secondary" onClick={() => {
          setLoading(true);
          setError(false);
          if (error) setAttempt((n) => n + 1);
          else setBefore(next);
        }}>
          {error ? "Try again" : "Load more tracks"}
        </button>
      )}
    </>
  );
}

export default function CatalogBrowser({ manage = false }: { manage?: boolean }) {
  const [q, setQ] = useState("");
  const query = q.trim();
  const [revision, setRevision] = useState(0);
  const [feedback, setFeedback] = useState("");
  const search = useRef<HTMLInputElement>(null);

  return (
    <>
      <form className="search-row" onSubmit={(e) => e.preventDefault()} role="search">
        <input
          ref={search}
          placeholder="Title, artist, album, or year"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search catalog"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search">✕</button>
        )}
      </form>
      {feedback && <p className="status" role="status">{feedback}</p>}
      <CatalogResults key={JSON.stringify([query, revision])} query={query} manage={manage} onChanged={(message) => {
        setFeedback(message);
        setRevision((n) => n + 1);
        search.current?.focus();
      }} />
    </>
  );
}
