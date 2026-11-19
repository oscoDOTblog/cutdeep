import { fpUrl, proxyJson } from "../_proxy";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1), 500);
  const params = new URLSearchParams({ q, limit: String(limit) });
  const before = url.searchParams.get("before");
  if (before) params.set("before", before);
  return proxyJson(req, `${fpUrl("/search")}?${params}`);
}
