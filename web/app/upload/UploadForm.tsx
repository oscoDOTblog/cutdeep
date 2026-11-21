"use client";

import { useEffect, useState } from "react";
import ResultCard from "../components/ResultCard";
import TileIcon from "../components/TileIcon";
import { apiError, readJson } from "../lib/api";

type Meta = { title: string; artist: string; thumbnail: string; duration: number; source_url: string };
type Job = {
  job_id: string;
  status: string;
  progress: number;
  speed_bps?: number;
  eta_s?: number | null;
  track_id?: number;
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  cover_url?: string;
  source_url?: string;
  n_hashes?: number;
  deduped?: boolean;
  error?: string;
};

function terminal(job: Job) {
  return ["done", "failed", "cancelled"].includes(job.status);
}

function jobStatus(job: Job) {
  switch (job.status) {
    case "fetching": {
      const speed = formatSpeed(job.speed_bps);
      return `Downloading audio… ${Math.round(job.progress * 100)}%${speed ? ` · ${speed}` : ""}${
        job.eta_s != null ? ` · ~${job.eta_s}s left` : ""
      }`;
    }
    case "fingerprinting": return "Adding to catalog…";
    case "cancelling": return "Cancelling…";
    case "done": return job.deduped ? "Already in catalog" : "Added to catalog";
    case "failed": return job.error || "Import failed.";
    case "cancelled": return "Import cancelled";
    default: return "Queued";
  }
}

function formatSpeed(bps?: number): string {
  if (!bps || bps <= 0) return "";
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

export default function UploadForm() {
  const [mode, setMode] = useState<"link" | "files" | null>(null);

  // Files mode (upload with metadata)
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileTitle, setFileTitle] = useState("");
  const [fileArtist, setFileArtist] = useState("");
  const [fileAlbum, setFileAlbum] = useState("");
  const [fileYear, setFileYear] = useState("");
  const [adding, setAdding] = useState(false);
  const [fileError, setFileError] = useState("");
  const [added, setAdded] = useState<{
    track_id: number;
    title: string;
    artist: string;
    album: string;
    year: string;
    n_hashes: number;
    deduped: boolean;
  } | null>(null);

  // Link mode (videodl-style flow)
  const [url, setUrl] = useState("");
  const [metaLoading, setMetaLoading] = useState(false);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [linkTitle, setLinkTitle] = useState("");
  const [linkArtist, setLinkArtist] = useState("");
  const [linkAlbum, setLinkAlbum] = useState("");
  const [linkYear, setLinkYear] = useState("");
  const [linkError, setLinkError] = useState("");
  const [starting, setStarting] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [suggestMsg, setSuggestMsg] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsError, setJobsError] = useState("");
  const [jobAction, setJobAction] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const job = jobs.find((j) => j.job_id === currentJobId);

  useEffect(() => {
    if (mode !== "link") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const r = await fetch("/api/link/jobs", { signal: controller.signal });
        const { ok, data } = await readJson(r);
        if (!ok) throw new Error("Could not load imports");
        if (!controller.signal.aborted) {
          setJobs(data.jobs);
          setJobsError((message) => message === "Could not refresh import status. Retrying…" ? "" : message);
          if (currentJobId && !data.jobs.some((j: Job) => j.job_id === currentJobId)) setCurrentJobId(null);
        }
      } catch {
        if (!controller.signal.aborted && currentJobId) setJobsError("Could not refresh import status. Retrying…");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 1500);
      }
    };
    // Wait until the start request returns before replacing the list.
    if (!starting) load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [mode, starting, currentJobId, refresh]);

  async function updateJobs(path: string) {
    setJobAction(true);
    setJobsError("");
    try {
      const response = await fetch(`/api/link/jobs${path}`, { method: "DELETE" });
      const { ok, data } = await readJson(response);
      if (!ok) throw new Error(apiError(data, "Could not update imports."));
      if (data.status === "fingerprinting") setJobsError("This track is already being added to the catalog.");
    } catch (e) {
      setJobsError(e instanceof Error ? e.message : "Could not update imports.");
    } finally {
      setRefresh((n) => n + 1);
      setJobAction(false);
    }
  }

  function resetLinkDetails() {
    setMeta(null);
    setCurrentJobId(null);
    setLinkError("");
    setLinkTitle("");
    setLinkArtist("");
    setLinkAlbum("");
    setLinkYear("");
    setSuggestMsg("");
  }

  function backToOptions() {
    resetLinkDetails();
    setJobsError("");
    setMode(null);
    setAudioFile(null);
    setFileName("");
    setFileTitle("");
    setFileArtist("");
    setFileAlbum("");
    setFileYear("");
    setFileError("");
    setAdded(null);
  }

  async function addToCatalog() {
    if (!audioFile || adding) return;
    setFileError("");
    setAdded(null);
    setAdding(true);
    try {
      const fd = new FormData();
      fd.append("file", audioFile, audioFile.name);
      fd.append("title", fileTitle.trim() || fileName);
      fd.append("artist", fileArtist.trim());
      fd.append("album", fileAlbum.trim());
      fd.append("year", fileYear.trim());
      const res = await fetch("/api/ingest", { method: "POST", body: fd });
      const { ok, data } = await readJson(res);
      if (!ok) throw new Error(apiError(data, "Could not add to catalog"));
      setAdded({
        track_id: data.track_id,
        title: data.title,
        artist: data.artist || "",
        album: data.album || "",
        year: data.year || "",
        n_hashes: data.n_hashes ?? 0,
        deduped: Boolean(data.deduped),
      });
      setAudioFile(null);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : "Could not add to catalog.");
    } finally {
      setAdding(false);
    }
  }

  async function loadDetails() {
    const u = url.trim();
    if (!u || metaLoading) return;
    setMetaLoading(true);
    resetLinkDetails();
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
      setLinkAlbum(data.album || "");
      setLinkYear(data.year || "");
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Could not load details");
    } finally {
      setMetaLoading(false);
    }
  }

  async function startImport() {
    if (!meta || starting || (job && !terminal(job))) return;
    setLinkError("");
    setJobsError("");
    setStarting(true);
    try {
      const fd = new FormData();
      fd.append("url", meta.source_url);
      fd.append("title", linkTitle.trim());
      fd.append("artist", linkArtist.trim());
      fd.append("album", linkAlbum.trim());
      fd.append("year", linkYear.trim());
      const res = await fetch("/api/link/import", { method: "POST", body: fd });
      const started = await readJson(res);
      if (!started.ok) throw new Error(apiError(started.data, "Could not start import"));
      const jobId = started.data.job_id as string;
      setCurrentJobId(jobId);
      setJobs((previous) => [{ job_id: jobId, title: linkTitle, status: "queued", progress: 0 }, ...previous]);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : "Could not start import");
    } finally {
      setStarting(false);
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
            <span className="tile-title">Import from link</span>
            <span className="tile-sub">Paste a SoundCloud, YouTube, or Bandcamp URL. We pull the audio and fingerprint it.</span>
          </button>
          <button type="button" className="tile-card" onClick={() => setMode("files")}>
            <span className="tile-glyph" aria-hidden="true">
              <TileIcon name="files" />
            </span>
            <span className="tile-title">Upload a track</span>
            <span className="tile-sub">Add a reference audio file from your device for future matches.</span>
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <button type="button" className="settings-back" onClick={backToOptions} disabled={adding || metaLoading || starting || suggesting}>
        <span aria-hidden="true">‹</span> Back to upload options
      </button>

      {mode === "link" && (
        <>
          <h2 className="sec">
            <span className="dia">◆</span> Import from link
          </h2>
          <form className="link-row" onSubmit={(e) => { e.preventDefault(); void loadDetails(); }}>
            <input
              placeholder="SoundCloud / YouTube / Bandcamp URL…"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                resetLinkDetails();
              }}
              aria-label="Audio URL"
              type="url"
              disabled={metaLoading || starting || suggesting}
            />
            <button type="submit" className="go-btn" disabled={!url.trim() || metaLoading || starting || suggesting}>
              {metaLoading ? "Loading…" : "Load details"}
            </button>
          </form>
          {linkError && <div className="err" role="alert">{linkError}</div>}
          {linkError && !meta && url.trim() && (
            <>
              <button
                type="button"
                className="secondary"
                disabled={suggesting || suggestMsg === "Saved for review. Thanks."}
                onClick={async () => {
                  setSuggestMsg("");
                  setSuggesting(true);
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
                  } finally {
                    setSuggesting(false);
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
              <fieldset className="grid" disabled={starting || Boolean(job && !terminal(job)) || job?.status === "done"}>
                <label>Title<input value={linkTitle} onChange={(e) => setLinkTitle(e.target.value)} /></label>
                <label>Artist / DJ<input value={linkArtist} onChange={(e) => setLinkArtist(e.target.value)} /></label>
                <label>Album<input value={linkAlbum} onChange={(e) => setLinkAlbum(e.target.value)} /></label>
                <label>Release year<input value={linkYear} onChange={(e) => setLinkYear(e.target.value)} inputMode="numeric" placeholder="YYYY" /></label>
              </fieldset>
              {(!job || job.status === "failed" || job.status === "cancelled") && (
                <button type="button" className="btn-amber" onClick={startImport} disabled={starting}>
                  {starting ? "Starting import…" : job ? "Retry import" : "Import track"}
                </button>
              )}
            </section>
          )}

          {job && (
            <section className="card">
              <div className="t hud">
                <span className="dia">◆</span>{" "}
                {job.title || "Track import"}
              </div>
              {job.status === "fetching" && (
                <div className="hp mid" aria-hidden="true">
                  <i style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </div>
              )}
              <div className={job.status === "failed" ? "err" : "meta"} role={job.status === "fetching" ? undefined : "status"}>
                {jobStatus(job)}
              </div>
              {(job.status === "fetching" || job.status === "queued") && (
                <button
                  type="button"
                  className="secondary"
                  disabled={jobAction}
                  onClick={() => updateJobs(`/${job.job_id}`)}
                >
                  Cancel import
                </button>
              )}
              {job.status === "done" && (
                <ResultCard
                  title={job.title || linkTitle}
                  artist={job.artist ?? ""}
                  album={job.album ?? ""}
                  year={job.year}
                  sourceUrl={job.source_url || meta?.source_url || ""}
                  conf={1}
                  votes={0}
                  coverUrl={job.cover_url}
                  stats={`${job.n_hashes ?? 0} landmarks indexed`}
                />
              )}
            </section>
          )}

          {jobsError && <div className="err" role="alert">{jobsError}</div>}
          {jobs.some((j) => j.job_id !== currentJobId || terminal(j)) && (
            <section>
              <h2 className="sec">
                <span className="dia">◆</span> Imports
              </h2>
              {jobs.filter((j) => j.job_id !== currentJobId).map((j) => {
                const canCancel = j.status === "queued" || j.status === "fetching";
                return (
                  <div className="card row" key={j.job_id}>
                    <div className="rowbody">
                      <div className="t hud">
                        <span className="dia">◆</span> {j.title || "Untitled import"}
                      </div>
                      <div className="meta">
                        {jobStatus(j)}
                      </div>
                      {canCancel && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={jobAction}
                          onClick={() => updateJobs(`/${j.job_id}`)}
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {jobs.some(terminal) && (
                <button
                  type="button"
                  className="secondary"
                  disabled={jobAction}
                  onClick={() => updateJobs("")}
                >
                  Clear finished
                </button>
              )}
            </section>
          )}
        </>
      )}

      {mode === "files" && (
        <>
          <h2 className="sec">
            <span className="dia">◆</span> Upload a track
          </h2>
          <section>
            <span className="file-wrap">
              <span className="file-btn" aria-hidden="true">
                ◆ Choose audio file
              </span>
              <input
                type="file"
                accept="audio/*"
                disabled={adding}
                aria-label="Choose audio file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setAudioFile(f);
                    setFileName(f.name);
                    setFileTitle(f.name.replace(/\.[^.]+$/, ""));
                    setFileArtist("");
                    setFileAlbum("");
                    setFileYear("");
                    setAdded(null);
                    setFileError("");
                    e.currentTarget.value = "";
                  }
                }}
              />
            </span>
            {fileName && <span className="file-name">◆ {fileName}</span>}
          </section>

          {audioFile && (
            <section className="card">
              <div className="t hud">
                <span className="dia">◆</span> Track details
              </div>
              <fieldset className="grid" disabled={adding}>
                <label>Title<input value={fileTitle} onChange={(e) => setFileTitle(e.target.value)} /></label>
                <label>Artist / DJ<input value={fileArtist} onChange={(e) => setFileArtist(e.target.value)} /></label>
                <label>Album<input value={fileAlbum} onChange={(e) => setFileAlbum(e.target.value)} /></label>
                <label>Year<input value={fileYear} onChange={(e) => setFileYear(e.target.value)} inputMode="numeric" /></label>
              </fieldset>
              <button type="button" className="btn-amber" onClick={addToCatalog} disabled={adding}>
                {adding ? "Adding…" : "◆ Add to catalog"}
              </button>
              {fileError && <div className="err" role="alert">{fileError}</div>}
            </section>
          )}

          {added && (
            <section>
              <p className="status" role="status">{added.deduped ? "Already in catalog" : "Added to catalog"}</p>
              <ResultCard
                title={added.title}
                artist={added.artist}
                sourceUrl=""
                conf={1}
                votes={0}
                year={added.year}
                album={added.album}
                stats={`${added.n_hashes} landmarks indexed`}
              />
            </section>
          )}
        </>
      )}
    </>
  );
}
