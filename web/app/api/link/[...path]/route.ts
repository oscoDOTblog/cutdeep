import { fpUrl, proxyJson } from "../../_proxy";
import { requireAdminApi } from "../../../lib/admin-auth";

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const denied = await requireAdminApi(req);
  if (denied) return denied;

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
