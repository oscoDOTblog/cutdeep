"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import SavedScanCard from "../components/SavedScanCard";
import { loadScans, removeScan, type Scan } from "../lib/scans";

function dayKey(ts: number) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function groupLabel(ts: number, today: string, yesterday: string) {
  const k = dayKey(ts);
  if (k === today) return "Today";
  if (k === yesterday) return "Yesterday";
  return "Earlier";
}

export default function Library() {
  const [scans, setScans] = useState<Scan[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setScans(loadScans());
  }, []);

  if (scans === null) return null;
  if (scans.length === 0) {
    return (
      <>
        <h2 className="sec">
          <span className="dia">◆</span> Library
        </h2>
        <p className="empty">Nothing scanned yet. Hit the dial on Home at the next battle.</p>
      </>
    );
  }

  const now = new Date();
  const today = dayKey(now.getTime());
  const previousDay = new Date(now);
  previousDay.setDate(now.getDate() - 1);
  const yesterday = dayKey(previousDay.getTime());
  const groups = new Map<string, Scan[]>();
  for (const s of scans) {
    const label = groupLabel(s.ts, today, yesterday);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(s);
  }

  return (
    <>
      <h2 className="sec">
        <span className="dia">◆</span> Library
      </h2>
      <div className="library-summary">
        <p className="status">{scans.length} saved scan{scans.length === 1 ? "" : "s"} on this device</p>
        <Link className="settings-back" href="/library/manage">Manage scans</Link>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {[...groups].map(([label, items]) => (
        <section key={label}>
          <h2 className="sec">{label}</h2>
          {items.map((s, index) => (
            <div key={`${s.ts}-${index}`} className="lib-row">
              <div className="lib-row-body">
                <SavedScanCard scan={s} />
              </div>
              <button
                type="button"
                className="lib-remove"
                aria-label={`Remove ${s.title} from library`}
                onClick={() => {
                  try {
                    setScans(removeScan(s));
                    setError("");
                  } catch {
                    setError("Could not remove the scan from this device.");
                  }
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
