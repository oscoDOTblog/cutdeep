const FP = process.env.FP_API_URL ?? "http://localhost:8000";

export async function POST(req: Request) {
  const payload = await req.json();
  const upstream = await fetch(`${FP}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
