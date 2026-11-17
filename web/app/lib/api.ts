import type { Candidate } from "./scans";

/** Parse a JSON API reply, surfacing transport failures as readable errors. */
export async function readJson(res: Response): Promise<{ ok: boolean; data: any }> {
  const text = await res.text();
  if (!text) {
    throw new Error(`empty reply (HTTP ${res.status}) — is the matching service running?`);
  }
  try {
    return { ok: res.ok, data: JSON.parse(text) };
  } catch {
    throw new Error(`unreadable reply (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
}

export function apiError(data: any, fallback: string): string {
  const detail = data?.detail;
  if (typeof detail === "string" && detail) return detail;
  return fallback;
}

export async function identifyClip(blob: Blob, name: string): Promise<Candidate[]> {
  const fd = new FormData();
  fd.append("file", blob, name);
  let res: Response;
  try {
    res = await fetch("/api/identify", { method: "POST", body: fd });
  } catch {
    throw new Error("could not reach the matching service — is fp-api running?");
  }
  const { ok, data } = await readJson(res);
  if (!ok) throw new Error(apiError(data, "identify failed"));
  return (data.candidates ?? []) as Candidate[];
}
