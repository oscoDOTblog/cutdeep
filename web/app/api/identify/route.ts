const FP = process.env.FP_API_URL ?? "http://localhost:8000";

export async function POST(req: Request) {
  const form = await req.formData();
  const upstream = await fetch(`${FP}/identify`, { method: "POST", body: form });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
