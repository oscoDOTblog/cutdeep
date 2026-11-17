"use client";

import { useEffect, useRef, useState } from "react";
import ResultCard from "../components/ResultCard";
import TileIcon from "../components/TileIcon";
import { apiError, identifyClip, readJson } from "../lib/api";
import type { Candidate } from "../lib/scans";

type Meta = { title: string; artist: string; thumbnail: string; duration: number; source_url: string };
type Job = {
  job_id: string;
  status: string;
  progress: number;
  track_id?: number;
  title?: string;
  artist?: string;
  cover_url?: string;
  error?: string;
};

export default function Upload() {
  const [mode, setMode] = useState<"link" | "files" | null>(null);

  // Files mode (existing flow)
  const [fileName, setFileName] = useState("");
  const [matching, setMatching] = useState(false);
  const [fileError, setFileError] = useState("");
  const [searched, setSearched] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  // Link mode (videodl-style flow)
  const [url, setUrl] = useState("");
  const [metaLoading, setMetaLoading] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkArtist, setLinkArtist] = useState("");
  const [linkError, setLinkError] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [suggestMsg, setSuggestMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function backToOptions() {
    if (pollRef.current) clearInterval(pollRef.current);
    setMode(null);
    setMeta(null);
    setJob(null);
    setLinkError("");
    setCandidates([]);
    setSearched(false);
  }

  async function uploadFile(f: File) {
    setFileError("");
    setSearched(false);
    setMatching(true);
    try {
      setCandidates(await identifyClip(f, f.name));
      setSearched(true);
    } catch {
      setFileError("Match failed. Try a louder, closer clip.");
    } finally {
      setMatching(false);
    }
  }

  async function loadDetails() {
    const u = url.trim();
    if (!u || metaLoading) return;
    setMetaLoading(true);
    setLinkError("");
    setMeta(null);
    setJob(null);
    try {
      const res = await fetch("/api/link/metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      const { ok, data } = await readJson(res);
      if (!ok) throw new Error(apiError(data, "Could not load details"));
      setMeta(data);
      setLinkTitle(data.title || "");
      setLinkArtist(data.artist || "");
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Could not load details");
    } finally {
      setMetaLoading(false);
    }
  }

  async function startImport() {
    const u = url.trim();
    if (!u) return;
    setLinkError("");
    setJob(null);
    try {
      const res = await fetch("/api/link/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u, title: linkTitle, artist: linkArtist, thumbnail: meta?.thumbnail ?? "" }),
      });
      const started = await readJson(res);
      if (!started.ok) throw new Error(apiError(started.data, "Could not start import"));
      const jobId = started.data.job_id as string;
      setJob({ job_id: jobId, status: "queued", progress: 0 });
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/link/jobs/${jobId}`);
          const { ok, data } = await readJson(r);
          if (!ok) return;
          const j = data as Job;
          setJob(j);
          if (j.status === "done" || j.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {
          /* keep polling; a transient failure is not the job failing */
        }
      }, 1000);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Could not start import");
    }
  }

  if (mode === null) {
    return (
      <>
        <h2 className="sec">
          <span className="dia">◆</span> Add to catalog
        </h2>
        <div className="tiles">
          <button type="button" className="tile-card" onClick={() => setMode("link")}>
            <span className="tile-glyph" aria-hidden="true">
              <TileIcon name="link" />
            </span>
            <span className="tile-title">Fetch with link</span>
            <span className="tile-sub">Paste a SoundCloud, YouTube, or Bandcamp URL. We pull the audio and fingerprint it.</span>
          </button>
          <button type="button" className="tile-card" onClick={() => setMode("files")}>
            <span className="tile-glyph" aria-hidden="true">
              <TileIcon name="files" />
            </span>
            <span className="tile-title">Upload with files</span>
            <span className="tile-sub">Choose an audio file from your device and match it right away.</span>
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <button type="button" className="back-link" onClick={backToOptions}>
        ◆ Back to upload options
      </button>

      {mode === "link" && (
        <>
          <h2 className="sec">
            <span className="dia">◆</span> Fetch with link
          </h2>
          <div className="link-row">
            <input
              placeholder="SoundCloud / YouTube / Bandcamp URL…"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setMeta(null);
                setJob(null);
              }}
              aria-label="Audio URL"
              disabled={metaLoading}
            />
            <button type="button" className="go-btn" onClick={loadDetails} disabled={!url.trim() || metaLoading}>
              {metaLoading ? "Loading…" : "Load details"}
            </button>
          </div>
          {linkError && <div className="err">{linkError}</div>}
          {linkError && url.trim() && (
            <>
              <button
                type="button"
                className="secondary"
                onClick={async () => {
                  setSuggestMsg("");
                  try {
                    const res = await fetch("/api/submit", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        title: linkTitle || url.trim(),
                        artist: linkArtist,
                        source_url: url.trim(),
                        note: "suggested after failed fetch",
                      }),
                    });
                    const { ok, data } = await readJson(res);
                    if (!ok) throw new Error(apiError(data, "Could not save suggestion"));
                    setSuggestMsg("Saved for review. Thanks.");
                  } catch (e) {
                    setSuggestMsg(e instanceof Error ? e.message : "Could not save suggestion.");
                  }
                }}
              >
                ◆ Suggest this link for review instead
              </button>
              {suggestMsg && <div className="status">{suggestMsg}</div>}
            </>
          )}

          {meta && (
            <section className="card">
              <div className="t hud">
                <span className="dia">◆</span> Review track details
              </div>
              {meta.thumbnail && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={meta.thumbnail} alt="" className="thumb" />
              )}
              <form className="grid" onSubmit={(e) => e.preventDefault()}>
                <input placeholder="Title" value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} aria-label="Title" />
                <input placeholder="Artist / DJ" value={linkArtist} onChange={(e) => setLinkArtist(e.target.value)} aria-label="Artist" />
              </form>
              {!job && (
                <button type="button" className="btn-amber" onClick={startImport}>
                  ◆ Import & add to catalog
                </button>
              )}
            </section>
          )}

          {job && (
            <section className="card">
              <div className="t hud">
                <span className="dia">◆</span> {job.status === "done" ? "Added to catalog" : job.status === "failed" ? "Import failed" : "Importing…"}
              </div>
              {job.status !== "done" && job.status !== "failed" && (
                <>
                  <div className={`hp mid`} aria-hidden="true">
                    <i style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                  <div className="meta">
                    {job.status === "fetching" ? `Fetching audio… ${Math.round(job.progress * 100)}%` : job.status === "fingerprinting" ? "Fingerprinting…" : "Queued…"}
                  </div>
                </>
              )}
              {job.status === "failed" && <div className="err">{job.error || "Import failed."}</div>}
              {job.status === "done" && (
                <ResultCard
                  title={job.title || linkTitle}
                  artist={job.artist || linkArtist}
                  sourceUrl={url.trim()}
                  conf={1}
                  votes={0}
                  extra="freshly imported"
                  coverUrl={job.cover_url}
                />
              )}
            </section>
          )}
        </>
      )}

      {mode === "files" && (
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
            {fileError && <div className="err">{fileError}</div>}
          </section>

          {searched && !matching && (
            <section>
              {candidates.length === 0 ? (
                <p className="status">No match in the catalog yet. Try the link tile instead.</p>
              ) : (
                candidates.map((c) => (
                  <ResultCard
                    key={c.track_id}
                    title={c.title}
                    artist={c.artist}
                    sourceUrl={c.source_url}
                    conf={c.confidence}
                    votes={c.votes}
                    coverUrl={c.cover_url}
                  />
                ))
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
