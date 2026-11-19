"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import LinkStart from "./components/LinkStart";
import ResultCard from "./components/ResultCard";
import { identifyClip } from "./lib/api";
import { saveScan, type Candidate } from "./lib/scans";

const CLIP_SECS = 10;

type Phase = "idle" | "requesting" | "listening" | "matching" | "done";

type Recording = {
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>;
  request: AbortController;
};

function release(recording: Recording) {
  clearInterval(recording.timer);
  const rec = recording.recorder;
  if (!rec) return;
  rec.onstop = null;
  rec.onerror = null;
  if (rec.state !== "inactive") rec.stop();
  rec.stream.getTracks().forEach((track) => track.stop());
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const session = useRef<Recording | null>(null);

  function abandon() {
    const active = session.current;
    session.current = null;
    if (!active) return;
    active.request.abort();
    release(active);
  }

  useEffect(() => abandon, []);

  async function startListen() {
    if (session.current) return;
    setError("");
    setCandidates([]);
    setSecs(0);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording needs a supported browser on HTTPS or localhost.");
      return;
    }
    const active: Recording = { request: new AbortController() };
    session.current = active;
    setPhase("requesting");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (session.current !== active) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const rec = new MediaRecorder(stream);
      active.recorder = rec;
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onerror = () => {
        abandon();
        setError("Recording stopped unexpectedly. Try again.");
        setPhase("idle");
      };
      rec.onstop = async () => {
        release(active);
        if (session.current !== active) return;
        setPhase("matching");
        try {
          const blob = new Blob(chunks, { type: rec.mimeType });
          const found = await identifyClip(blob, "clip", active.request.signal);
          if (session.current !== active) return;
          setCandidates(found);
          const top = found[0];
          if (top && top.confidence >= 0.4) {
            saveScan({
              ts: Date.now(),
              title: top.title,
              artist: top.artist,
              album: top.album ?? "",
              sourceUrl: top.source_url,
              conf: top.confidence,
              votes: top.votes,
              coverUrl: top.cover_url ?? "",
            });
          }
        } catch {
          if (session.current !== active) return;
          setError("Could not match the recording. Try again.");
        }
        session.current = null;
        setPhase("done");
      };
      rec.start();
      const started = performance.now();
      setPhase("listening");
      active.timer = setInterval(() => {
        const elapsed = Math.min(CLIP_SECS, Math.floor((performance.now() - started) / 1000));
        setSecs(elapsed);
        if (elapsed >= CLIP_SECS && rec.state !== "inactive") rec.stop();
      }, 100);
    } catch (e) {
      stream?.getTracks().forEach((track) => track.stop());
      if (session.current !== active) return;
      abandon();
      setError(e instanceof DOMException && e.name === "NotAllowedError"
        ? "Microphone access denied. Allow it in your browser and try again."
        : "Could not start recording. Check that a microphone is available.");
      setPhase("idle");
    }
  }

  function cancel() {
    abandon();
    setPhase("idle");
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

      {(phase === "idle" || phase === "requesting") && (
        <section className="dial-stage">
          <button className="dial" onClick={startListen} aria-label="Tap to identify music" disabled={phase === "requesting"}>
            ◆
          </button>
          <div className="dial-label">Tap to cutdeep</div>
          {error ? <div className="dial-sub" role="alert">{error}</div> : (
            <div className="dial-sub" role="status">{phase === "requesting" ? "Waiting for microphone permission…" : "10 second listen"}</div>
          )}
        </section>
      )}

      {phase === "listening" && (
        <section className="listen-stage">
          <button className="x-btn" onClick={cancel} aria-label="Cancel listening">
            ✕
          </button>
          <div className="rings" aria-hidden="true">
            <span className="ring" />
            <span className="ring" />
            <span className="ring" />
            <span className="ring-core">◆</span>
          </div>
          <div className="listen-words">
            <span role="status">Listening…</span> {secs}s
          </div>
          <div className="listen-tip">Make sure your device can hear the song clearly</div>
        </section>
      )}

      {phase === "matching" && (
        <section>
          <LinkStart />
        </section>
      )}

      {phase === "done" && (
        <section>
          {error ? <p className="err" role="alert">{error}</p> : candidates.length === 0 ? (
            <p className="status" role="status">
              No match in the catalog yet.{" "}
              Try another recording, or <Link href="/upload">add a reference track</Link> if you know the remix.
            </p>
          ) : (
            candidates.map((c) => (
              <ResultCard
                key={c.track_id}
                title={c.title}
                artist={c.artist}
                album={c.album}
                sourceUrl={c.source_url}
                conf={c.confidence}
                votes={c.votes}
                coverUrl={c.cover_url}
              />
            ))
          )}
          <button
            className="secondary scan-again"
            onClick={() => {
              setCandidates([]);
              setPhase("idle");
            }}
          >
            Scan again
          </button>
        </section>
      )}
    </>
  );
}
