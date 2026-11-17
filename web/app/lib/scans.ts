export type Scan = {
  ts: number;
  title: string;
  artist: string;
  sourceUrl: string;
  conf: number;
  votes: number;
};

export type Candidate = {
  track_id: number;
  title: string;
  artist: string;
  source_url: string;
  votes: number;
  confidence: number;
};

const LIB_KEY = "cutdeep-library";
const LEGACY_KEY = "cutdeep-history";
const MAX = 100;

function toScan(raw: unknown): Scan | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  // Legacy shape: {ts, top, conf}
  if (typeof r.top === "string") {
    return {
      ts: typeof r.ts === "number" ? r.ts : Date.now(),
      title: r.top,
      artist: "",
      sourceUrl: "",
      conf: typeof r.conf === "number" ? r.conf : 0,
      votes: 0,
    };
  }
  if (typeof r.title !== "string" || typeof r.ts !== "number") return null;
  return {
    ts: r.ts,
    title: r.title,
    artist: typeof r.artist === "string" ? r.artist : "",
    sourceUrl: typeof r.sourceUrl === "string" ? r.sourceUrl : "",
    conf: typeof r.conf === "number" ? r.conf : 0,
    votes: typeof r.votes === "number" ? r.votes : 0,
  };
}

export function loadScans(): Scan[] {
  try {
    const out: Scan[] = [];
    for (const key of [LIB_KEY, LEGACY_KEY]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const s = toScan(item);
        if (s && s.conf > 0) out.push(s);
      }
    }
    return out.sort((a, b) => b.ts - a.ts).slice(0, MAX);
  } catch {
    return [];
  }
}

export function saveScan(scan: Scan): Scan[] {
  const next = [scan, ...loadScans()].slice(0, MAX);
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* storage full or unavailable; library just won't persist */
  }
  return next;
}
