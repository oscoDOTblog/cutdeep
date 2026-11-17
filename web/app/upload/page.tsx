"use client";

import { useState } from "react";
import LinkStart from "../components/LinkStart";
import ResultCard from "../components/ResultCard";
import { identifyClip } from "../lib/api";
import type { Candidate } from "../lib/scans";

export default function Upload() {
  const [fileName, setFileName] = useState("");
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [link, setLink] = useState({ title: "", artist: "", source_url: "", note: "" });
  const [linkMsg, setLinkMsg] = useState("");

  async function uploadFile(f: File) {
    setError("");
    setSearched(false);
    setMatching(true);
    try {
      setCandidates(await identifyClip(f, f.name));
      setSearched(true);
    } catch {
      setError("Match failed. Try a louder, closer clip.");
    } finally {
      setMatching(false);
    }
  }

  async function submitLink(e: React.FormEvent) {
    e.preventDefault();
    setLinkMsg("");
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(link),
    });
    if (!res.ok) {
      setLinkMsg("Could not save. Include at least a title.");
      return;
    }
    setLink({ title: "", artist: "", source_url: "", note: "" });
    setLinkMsg("Saved. It will be reviewed for the catalog.");
  }

  return (
    <>
      <h2 className="sec">
        <span className="dia">◆</span> Identify a clip
      </h2>
      <section>
        <span className="file-wrap">
          <span className="file-btn" aria-hidden="true">
            ◆ Choose audio file
          </span>
          <input
            type="file"
            accept="audio/*"
            aria-label="Choose audio file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                setFileName(f.name);
                uploadFile(f);
              }
            }}
          />
        </span>
        {fileName && <span className="file-name">◆ {fileName}</span>}
        {matching && <LinkStart />}
        {error && <div className="err">{error}</div>}
      </section>

      {searched && !matching && (
        <section>
          {candidates.length === 0 ? (
            <p className="status">No match in the catalog yet. Add the link below.</p>
          ) : (
            candidates.map((c) => (
              <ResultCard
                key={c.track_id}
                title={c.title}
                artist={c.artist}
                sourceUrl={c.source_url}
                conf={c.confidence}
                votes={c.votes}
              />
            ))
          )}
        </section>
      )}

      <section>
        <h2 className="sec">
          <span className="dia">◆</span> Know this remix? Add the link
        </h2>
        <form className="grid" onSubmit={submitLink}>
          <input
            placeholder="Title (required)"
            value={link.title}
            onChange={(e) => setLink({ ...link, title: e.target.value })}
          />
          <input
            placeholder="Artist / DJ"
            value={link.artist}
            onChange={(e) => setLink({ ...link, artist: e.target.value })}
          />
          <input
            placeholder="SoundCloud / YouTube / Bandcamp URL"
            value={link.source_url}
            onChange={(e) => setLink({ ...link, source_url: e.target.value })}
          />
          <textarea
            placeholder="Where did you hear it? (battle, round, DJ…)"
            rows={2}
            value={link.note}
            onChange={(e) => setLink({ ...link, note: e.target.value })}
          />
          <button className="secondary" type="submit">
            Submit link
          </button>
        </form>
        {linkMsg && <div className="status">{linkMsg}</div>}
      </section>
    </>
  );
}
