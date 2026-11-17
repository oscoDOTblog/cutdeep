"use client";

import { useEffect, useState } from "react";
import ResultCard from "../components/ResultCard";
import { loadScans, type Scan } from "../lib/scans";

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
  const yesterday = dayKey(now.getTime() - 86400000);
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
      <p className="status">
        {scans.length} song{scans.length === 1 ? "" : "s"}
      </p>
      {[...groups].map(([label, items]) => (
        <section key={label}>
          <h2 className="sec">{label}</h2>
          {items.map((s) => (
            <ResultCard
              key={s.ts}
              title={s.title}
              artist={s.artist}
              sourceUrl={s.sourceUrl}
              conf={s.conf}
              votes={s.votes}
              extra={new Date(s.ts).toLocaleString()}
            />
          ))}
        </section>
      ))}
    </>
  );
}
