const FP = process.env.FP_API_URL ?? "http://localhost:8000";

/** Forward to fp-api, returning JSON even when the backend is unreachable. */
export async function proxyJson(req: Request, target: string) {
  let upstream: Response;
  try {
    const init: RequestInit & { duplex?: string } = { method: req.method };
    if (req.method !== "GET" && req.method !== "HEAD") {
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("multipart/form-data")) {
        init.headers = { "Content-Type": ct };
        init.body = req.body;
        init.duplex = "half";
      } else {
        init.headers = { "Content-Type": "application/json" };
        init.body = await req.text();
      }
    }
    upstream = await fetch(target, init);
  } catch {
    return Response.json(
      { detail: `matching service unreachable at ${FP} — is fp-api running?` },
      { status: 502 }
    );
  }
  const text = await upstream.text();
  return new Response(text || '{"detail":"empty reply from matching service"}', {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export function fpUrl(path: string) {
  return `${FP}${path}`;
}
