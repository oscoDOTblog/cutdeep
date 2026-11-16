const FP = process.env.FP_API_URL ?? "http://localhost:8000";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const upstream = await fetch(`${FP}/search?q=${encodeURIComponent(q)}`);
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
