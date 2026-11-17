"use client";

import { useState } from "react";
import ResultCard from "../components/ResultCard";
import type { Candidate } from "../lib/scans";

export default function Search() {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [results, setResults] = useState<Candidate[]>([]);

  async function run(e?: React.FormEvent) {
    e?.preventDefault();
    const query = q.trim();
    if (!query || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setResults((data.results ?? []) as Candidate[]);
      setSearched(true);
    } catch {
      setError("Search failed. Is the catalog service up?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h2 className="sec">
        <span className="dia">◆</span> Search the catalog
      </h2>
      <form className="search-row" onSubmit={run}>
        <input
          placeholder="Title, remix, or DJ…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search catalog"
        />
        <button type="submit">Go</button>
      </form>
      {busy && <p className="status">Searching…</p>}
      {error && <div className="err">{error}</div>}
      {searched && !busy && results.length === 0 && !error && (
        <p className="empty">Nothing in the catalog matches. Try the Upload tab to add it.</p>
      )}
      {results.map((c) => (
        <ResultCard
          key={c.track_id}
          title={c.title}
          artist={c.artist}
          sourceUrl={c.source_url}
          conf={c.confidence ?? 1}
          votes={c.votes ?? 0}
        />
      ))}
    </>
  );
}
