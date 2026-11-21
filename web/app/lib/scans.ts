export type Scan = {
  ts: number;
  title: string;
  artist: string;
  album: string;
  year?: string;
  sourceUrl: string;
  conf: number;
  votes: number;
  coverUrl: string;
  matchStatus?: MatchStatus;
  bandcampTrackId?: string;
};

export type ScanDetails = Pick<Scan, "title" | "artist" | "album" | "year">;

export type MatchStatus = "likely" | "possible";

export type Candidate = {
  track_id: number;
  title: string;
  artist: string;
  source_url: string;
  votes: number;
  confidence: number;
  match_status?: MatchStatus;
  bandcamp_track_id?: string;
  cover_url?: string;
  year?: string;
  album?: string;
  n_hashes?: number;
};

const LIB_KEY = "cutdeep-library";
const LEGACY_KEY = "cutdeep-history";
export const MIN_LIBRARY_OVERLAP = 0.1;

function toScan(raw: unknown): Scan | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  // Legacy shape: {ts, top, conf}
  if (typeof r.top === "string") {
    return {
      ts: typeof r.ts === "number" ? r.ts : 0,
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
    year: typeof r.year === "string" ? r.year : undefined,
    sourceUrl: typeof r.sourceUrl === "string" ? r.sourceUrl : "",
    conf: typeof r.conf === "number" ? r.conf : 0,
    votes: typeof r.votes === "number" ? r.votes : 0,
    coverUrl: typeof r.coverUrl === "string" && /^https?:\/\//i.test(r.coverUrl) ? r.coverUrl : "",
    matchStatus: r.matchStatus === "likely" || r.matchStatus === "possible" ? r.matchStatus : undefined,
    bandcampTrackId: typeof r.bandcampTrackId === "string" ? r.bandcampTrackId : undefined,
  };
}

function readScans(): Scan[] {
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
  return out.sort((a, b) => b.ts - a.ts);
}

function qualifiesForLibrary(scan: Scan): boolean {
  return scan.conf > MIN_LIBRARY_OVERLAP;
}

export function loadScans(): Scan[] {
  return readScans().filter(qualifiesForLibrary);
}

function writeScans(scans: Scan[]) {
  localStorage.setItem(LIB_KEY, JSON.stringify(scans));
  localStorage.removeItem(LEGACY_KEY);
}

function scanIndex(scans: Scan[], original: Scan) {
  return scans.findIndex((scan) => scan.ts === original.ts && scan.title === original.title
    && scan.artist === original.artist && scan.album === original.album);
}

export function removeScan(original: Scan): Scan[] {
  const next = readScans();
  const index = scanIndex(next, original);
  if (index !== -1) {
    next.splice(index, 1);
    writeScans(next);
  }
  return next.filter(qualifiesForLibrary);
}

export function updateScan(original: Scan, details: ScanDetails): Scan[] {
  const next = readScans();
  const index = scanIndex(next, original);
  if (index === -1) throw new Error("This scan has changed. Reopen the scanned library to try again.");
  next[index] = { ...next[index], ...details };
  writeScans(next);
  return next.filter(qualifiesForLibrary);
}

export function saveScan(scan: Scan): boolean {
  try {
    writeScans([scan, ...readScans()]);
    return true;
  } catch {
    return false;
  }
}
