"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import LinkStart from "./components/LinkStart";
import ResultCard from "./components/ResultCard";
import { identifyClip } from "./lib/api";
import { saveScan, type Candidate } from "./lib/scans";

const CLIP_SECS = 10;

type Phase = "idle" | "listening" | "matching" | "done";

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const recRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function stopTracks() {
    recRef.current?.stream.getTracks().forEach((t) => t.stop());
  }

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function startListen() {
    setError("");
    setCandidates([]);
    cancelledRef.current = false;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone blocked. Allow mic access or use the Upload tab instead.");
      return;
    }
    const rec = new MediaRecorder(stream);
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = async () => {
      stopTracks();
      stopTimer();
      if (cancelledRef.current) {
        setPhase("idle");
        setSecs(0);
        return;
      }
      const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
      setPhase("matching");
      try {
        const found = await identifyClip(blob, "clip.webm");
        setCandidates(found);
        const top = found[0];
        if (top) {
          saveScan({
            ts: Date.now(),
            title: top.title,
            artist: top.artist,
            sourceUrl: top.source_url,
            conf: top.confidence,
            votes: top.votes,
            coverUrl: top.cover_url ?? "",
          });
        }
      } catch {
        setError("Could not reach the matching service.");
        setCandidates([]);
      }
      setPhase("done");
    };
    recRef.current = rec;
    rec.start();
    setPhase("listening");
    setSecs(0);
    timerRef.current = setInterval(() => {
      setSecs((s) => {
        const n = s + 1;
        if (n >= CLIP_SECS) rec.stop();
        return n;
      });
    }, 1000);
  }

  function cancel() {
    cancelledRef.current = true;
    recRef.current?.stop();
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

      {phase === "idle" && (
        <section className="dial-stage">
          <button className="dial" onClick={startListen} aria-label="Tap to identify music">
            ◆
          </button>
          <div className="dial-label">Tap to cutdeep</div>
          <div className="dial-sub">{error || "10 second listen"}</div>
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
          <div className="listen-words" role="status">
            Listening… {secs}s
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
          {candidates.length === 0 ? (
            <p className="status">
              No match in the catalog yet.{" "}
              <Link href="/upload">Add the link</Link> or try a louder clip.
            </p>
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
