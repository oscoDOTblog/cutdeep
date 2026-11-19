import { fpUrl } from "../_proxy";

export async function POST(req: Request) {
  const form = await req.formData();
  const target = fpUrl("/ingest");
  try {
    const upstream = await fetch(target, { method: "POST", body: form });
    const text = await upstream.text();
    return new Response(text || '{"detail":"empty reply from matching service"}', {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return Response.json(
      { detail: "matching service unreachable — is fp-api running?" },
      { status: 502 }
    );
  }
}
