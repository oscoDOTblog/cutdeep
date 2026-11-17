import { fpUrl, proxyJson } from "../_proxy";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  return proxyJson(req, `${fpUrl("/search")}?q=${encodeURIComponent(q)}`);
}
