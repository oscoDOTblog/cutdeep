export type Scan = {
  ts: number;
  title: string;
  artist: string;
  album: string;
  sourceUrl: string;
  conf: number;
  votes: number;
  coverUrl: string;
};

export type Candidate = {
  track_id: number;
  title: string;
  artist: string;
  source_url: string;
  votes: number;
  confidence: number;
  cover_url?: string;
  year?: string;
  album?: string;
  n_hashes?: number;
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
      coverUrl: "",
      album: "",
    };
  }
  if (typeof r.title !== "string" || typeof r.ts !== "number") return null;
  return {
    ts: r.ts,
    title: r.title,
    artist: typeof r.artist === "string" ? r.artist : "",
    album: typeof r.album === "string" ? r.album : "",
    sourceUrl: typeof r.sourceUrl === "string" ? r.sourceUrl : "",
    conf: typeof r.conf === "number" ? r.conf : 0,
    votes: typeof r.votes === "number" ? r.votes : 0,
    coverUrl: typeof r.coverUrl === "string" ? r.coverUrl : "",
  };
}

export function loadScans(): Scan[] {
  const out: Scan[] = [];
  for (const key of [LIB_KEY, LEGACY_KEY]) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const s = toScan(item);
        if (s && s.conf > 0) out.push(s);
      }
    } catch {
      /* A broken history entry should not hide the other store. */
    }
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, MAX);
}

export function removeScan(ts: number): Scan[] {
  const next = loadScans().filter((s) => s.ts !== ts);
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
  return next;
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
