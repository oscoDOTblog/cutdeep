"use client";

import { useEffect, useRef, useState } from "react";

type Candidate = {
  track_id: number;
  title: string;
  artist: string;
  source_url: string;
  votes: number;
  confidence: number;
};

type HistoryEntry = { ts: number; top: string; conf: number };

const CLIP_SECS = 10;

export default function Home() {
  const [recording, setRecording] = useState(false);
  const [matching, setMatching] = useState(false);
  const [secs, setSecs] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [searched, setSearched] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [link, setLink] = useState({ title: "", artist: "", source_url: "", note: "" });
  const [linkMsg, setLinkMsg] = useState("");
  const [fileName, setFileName] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("cutdeep-history");
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      /* corrupted history is not fatal */
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function pushHistory(top: string, conf: number) {
    const entry = { ts: Date.now(), top, conf };
    const next = [entry, ...history].slice(0, 20);
    setHistory(next);
    try {
      localStorage.setItem("cutdeep-history", JSON.stringify(next));
    } catch {
      setError("History could not be saved (browser storage unavailable).");
    }
  }

  async function identify(blob: Blob, name: string) {
    setError("");
    setSearched(false);
    setMatching(true);
    const fd = new FormData();
    fd.append("file", blob, name);
    let res: Response;
    try {
      res = await fetch("/api/identify", { method: "POST", body: fd });
    } catch {
      setError("Could not reach the matching service.");
      setMatching(false);
      return;
    }
    if (!res.ok) {
      setError("Match failed. Try a louder, closer clip.");
      setMatching(false);
      return;
    }
    const data = await res.json();
    setCandidates(data.candidates ?? []);
    setSearched(true);
    setMatching(false);
    const top = (data.candidates ?? [])[0] as Candidate | undefined;
    pushHistory(top ? `${top.title} — ${top.artist}` : "no match", top?.confidence ?? 0);
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function toggleRecord() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    setError("");
    setCandidates([]);
    setSearched(false);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone blocked. Allow mic access or upload a file instead.");
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      stopTimer();
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      identify(blob, "clip.webm");
    };
    recRef.current = rec;
    rec.start();
    setRecording(true);
    setSecs(0);
    setStatus("Listening… 0s");
    timerRef.current = setInterval(() => {
      setSecs((s) => {
        const n = s + 1;
        setStatus(`Listening… ${n}s`);
        if (n >= CLIP_SECS) rec.stop();
        return n;
      });
    }, 1000);
  }

  async function uploadFile(f: File) {
    setCandidates([]);
    await identify(f, f.name);
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
      <div className="rail" aria-hidden="true" />
      <div className="header-panel">
        <h1>
          <span className="dia">◆</span> cutdeep
        </h1>
        <p>Hold it up during the battle. Get the remix, not the original.</p>
      </div>

      <section>
        <button className={recording ? "btn-amber live" : "btn-amber"} onClick={toggleRecord}>
          {recording ? `Stop — ${secs}s` : "◆ Record 10s"}
        </button>
        {matching ? (
          <div className="linkstart" role="status" aria-label="Linking to catalog">
            <div className="diamonds" aria-hidden="true">
              <span>◆</span>
              <span>◆</span>
              <span>◆</span>
            </div>
            <div className="words">Link start</div>
            <div className="groove" aria-hidden="true">
              <i />
            </div>
          </div>
        ) : (
          <div className="status">{status}</div>
        )}
        {error && <div className="err">{error}</div>}
        <div className="upload">
          <div className="divider" aria-hidden="true">
            <span>or upload a clip instead</span>
          </div>
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
        </div>
      </section>

      {searched && (
        <section>
          {candidates.length === 0 ? (
            <p className="status">No match in the catalog yet. Add the link below.</p>
          ) : (
            candidates.map((c) => {
              const pct = Math.round(c.confidence * 100);
              const band = c.confidence >= 0.75 ? "high" : c.confidence >= 0.4 ? "mid" : "low";
              return (
                <div className="card" key={c.track_id}>
                  <div className="t">
                    <span className="dia">◆</span> {c.title}
                  </div>
                  {c.artist && <div className="a">{c.artist}</div>}
                  <div className={`hp ${band}`} aria-hidden="true">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <div className="meta">
                    {pct}% · {c.votes} landmark votes
                    {c.source_url && (
                      <>
                        {" · "}
                        <a href={c.source_url} target="_blank" rel="noreferrer">
                          source
                        </a>
                      </>
                    )}
                  </div>
                </div>
              );
            })
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

      {history.length > 0 && (
        <section className="hist">
          <h2 className="sec">
          <span className="dia">◆</span> Recent
        </h2>
          <ul>
            {history.map((h) => (
              <li key={h.ts}>
                {new Date(h.ts).toLocaleString()} — {h.top}
                {h.conf > 0 && ` (${Math.round(h.conf * 100)}%)`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
