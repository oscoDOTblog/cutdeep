import { fpUrl, proxyJson } from "../../../_proxy";
import { requireAdminApi } from "../../../../lib/admin-auth";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdminApi(req);
  if (denied) return denied;

  const { id } = await ctx.params;
  if (!/^[a-f0-9]{32}$/.test(id)) {
    return Response.json({ detail: "Catalog import not found." }, { status: 404 });
  }
  return proxyJson(req, fpUrl(`/catalog/imports/${id}`));
}
