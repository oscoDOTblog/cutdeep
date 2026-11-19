"use client";

import { useEffect, useState } from "react";
import ResultCard from "../components/ResultCard";
import { readJson } from "../lib/api";
import type { Candidate } from "../lib/scans";

function CatalogResults({ query }: { query: string }) {
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
      {results.map((c) => (
        <ResultCard
          key={c.track_id}
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
      ))}
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

export default function Search() {
  const [q, setQ] = useState("");
  const query = q.trim();

  return (
    <>
      <h2 className="sec"><span className="dia">◆</span> Search catalog</h2>
      <form className="search-row" onSubmit={(e) => e.preventDefault()} role="search">
        <input
          placeholder="Title, artist, or album"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search catalog"
        />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Clear search">✕</button>
        )}
      </form>
      <CatalogResults key={query} query={query} />
    </>
  );
}
