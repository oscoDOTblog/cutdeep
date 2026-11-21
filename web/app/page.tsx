"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import LinkStart from "./components/LinkStart";
import ResultCard from "./components/ResultCard";
import { identifyClip } from "./lib/api";
import { MIN_LIBRARY_OVERLAP, saveScan, type Candidate } from "./lib/scans";

const SCAN_LENGTHS = [10, 20] as const;
type ScanLength = (typeof SCAN_LENGTHS)[number];

type Phase = "idle" | "requesting" | "listening" | "matching" | "done";

type Recording = {
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>;
  audio?: AudioContext;
  request: AbortController;
};

function release(recording: Recording) {
  clearInterval(recording.timer);
  if (recording.audio) {
    void recording.audio.close().catch(() => {});
    recording.audio = undefined;
  }
  const rec = recording.recorder;
  if (!rec) return;
  rec.onstop = null;
  rec.onerror = null;
  if (rec.state !== "inactive") rec.stop();
  rec.stream.getTracks().forEach((track) => track.stop());
}

function createSignalReader(audio: AudioContext | undefined, stream: MediaStream) {
  if (!audio) return;
  try {
    const analyser = audio.createAnalyser();
    audio.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let level = 0;
    return () => {
      if (audio.state !== "running") return null;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const db = 10 * Math.log10(sum / samples.length);
      const strength = Math.max(0, Math.min(1, (db + 55) / 43));
      level = Math.max(strength, level * 0.75);
      return level;
    };
  } catch {
    // Recording can proceed on browsers that cannot read the signal level.
    return undefined;
  }
}

function ScanResult({ candidate, primary = false }: { candidate: Candidate; primary?: boolean }) {
  return (
    <ResultCard
      title={candidate.title}
      artist={candidate.artist}
      album={candidate.album}
      year={candidate.year}
      sourceUrl={candidate.source_url}
      conf={candidate.confidence}
      votes={candidate.votes}
      coverUrl={candidate.cover_url}
      scanResult={primary ? candidate.match_status ?? "possible" : "alternative"}
      bandcampTrackId={candidate.bandcamp_track_id}
    />
  );
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [scanLength, setScanLength] = useState<ScanLength>(10);
  const [secs, setSecs] = useState(0);
  const [signal, setSignal] = useState<number | null>();
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [librarySave, setLibrarySave] = useState<"saved" | "failed">();
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
    setLibrarySave(undefined);
    setSecs(0);
    setSignal(undefined);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording needs a supported browser on HTTPS or localhost.");
      return;
    }
    const active: Recording = { request: new AbortController() };
    session.current = active;
    setPhase("requesting");
    try {
      // Start in the click handler so the audio context can use its activation.
      active.audio = new AudioContext();
      void active.audio.resume().catch(() => {});
    } catch {
      // The meter is optional when Web Audio is unavailable.
    }
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
          if (top && top.confidence > MIN_LIBRARY_OVERLAP) {
            const saved = saveScan({
              ts: Date.now(),
              title: top.title,
              artist: top.artist,
              album: top.album ?? "",
              year: top.year,
              sourceUrl: top.source_url,
              conf: top.confidence,
              votes: top.votes,
              coverUrl: top.cover_url ?? "",
              matchStatus: top.match_status,
              bandcampTrackId: top.bandcamp_track_id,
            });
            setLibrarySave(saved ? "saved" : "failed");
          }
        } catch {
          if (session.current !== active) return;
          setError("Could not match the recording. Try again.");
        }
        session.current = null;
        setPhase("done");
      };
      rec.start();
      const readSignal = createSignalReader(active.audio, stream);
      const started = performance.now();
      setPhase("listening");
      active.timer = setInterval(() => {
        const elapsed = Math.min(scanLength, Math.floor((performance.now() - started) / 1000));
        setSecs(elapsed);
        setSignal(readSignal?.() ?? null);
        if (elapsed >= scanLength && rec.state !== "inactive") rec.stop();
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

  const [top, ...otherResults] = candidates;
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
          <fieldset className="scan-length" disabled={phase === "requesting"}>
            <legend>Scan length</legend>
            {SCAN_LENGTHS.map((length) => (
              <label key={length}>
                <input
                  type="radio"
                  name="scan-length"
                  value={length}
                  checked={scanLength === length}
                  onChange={() => setScanLength(length)}
                />
                {length} seconds
              </label>
            ))}
          </fieldset>
          {phase === "requesting" && (
            <div className="dial-sub" role="status">Waiting for microphone permission…</div>
          )}
          {error && <div className="dial-sub" role="alert">{error}</div>}
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
            <span role="status">Listening…</span> {secs} / {scanLength}s
          </div>
          <div className="listen-signal">
            <div className="hp mid" aria-hidden="true">
              <i style={{ width: `${(signal ?? 0) * 100}%` }} />
            </div>
            <div className="listen-tip" role="status">
              {signal === undefined ? "Checking microphone level…"
                : signal === null ? "Microphone level unavailable"
                : signal >= 0.3 ? "Sound detected"
                : "Quiet signal · move closer to the music"}
            </div>
          </div>
        </section>
      )}

      {phase === "matching" && (
        <section>
          <LinkStart />
        </section>
      )}

      {phase === "done" && (
        <section>
          {error ? <p className="err" role="alert">{error}</p> : !top ? (
            <p className="status" role="status">
              No reliable match.{" "}
              Try a clearer section, or <Link href="/upload">add a reference track</Link> if you know the remix.
            </p>
          ) : (
            <>
              <ScanResult candidate={top} primary />
              {librarySave === "saved" && (
                <p className="status" role="status">Saved to <Link href="/library">Library</Link>.</p>
              )}
              {librarySave === "failed" && (
                <p className="err" role="status">Could not save this scan on this device.</p>
              )}
              {otherResults.length > 0 && (
                <details className="scan-alternatives" open={top.match_status !== "likely"}>
                  <summary>Other results ({otherResults.length})</summary>
                  {otherResults.map((candidate) => <ScanResult key={candidate.track_id} candidate={candidate} />)}
                </details>
              )}
            </>
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
