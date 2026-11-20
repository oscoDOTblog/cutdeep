import { fpUrl } from "../../../_proxy";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return new Response(null, { status: 404 });

  const requestHeaders = new Headers();
  for (const name of ["Range", "If-Range"]) {
    const value = req.headers.get(name);
    if (value) requestHeaders.set(name, value);
  }

  try {
    const upstream = await fetch(fpUrl(`/tracks/${id}/preview`), {
      headers: requestHeaders,
      cache: "no-store",
      signal: req.signal,
    });
    const headers = new Headers();
    for (const name of ["Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Cache-Control", "ETag", "Last-Modified"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch {
    return new Response("Audio preview unavailable.", { status: 502 });
  }
}
