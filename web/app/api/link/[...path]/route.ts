import { fpUrl, proxyJson } from "../../_proxy";

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return proxyJson(req, `${fpUrl("/link")}/${(await ctx.params).path.join("/")}`);
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx);
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(req, ctx);
}
