import type { Candidate } from "./scans";

export async function identifyClip(blob: Blob, name: string): Promise<Candidate[]> {
  const fd = new FormData();
  fd.append("file", blob, name);
  const res = await fetch("/api/identify", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`identify failed: ${res.status}`);
  const data = await res.json();
  return (data.candidates ?? []) as Candidate[];
}
