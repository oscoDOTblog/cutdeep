import { fpUrl, proxyJson } from "../../_proxy";

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyJson(req, `${fpUrl("/link")}/${(await ctx.params).path.join("/")}`);
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyJson(req, `${fpUrl("/link")}/${(await ctx.params).path.join("/")}`);
}
