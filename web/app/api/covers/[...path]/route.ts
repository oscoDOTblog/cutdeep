import { fpUrl } from "../../_proxy";

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const target = `${fpUrl("/covers")}/${(await ctx.params).path.join("/")}`;
  try {
    const upstream = await fetch(target);
    if (!upstream.ok) return new Response("not found", { status: 404 });
    return new Response(await upstream.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("cover service unreachable", { status: 502 });
  }
}
