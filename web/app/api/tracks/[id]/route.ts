import { fpUrl, proxyJson } from "../../_proxy";
import { requireAdminApi } from "../../../lib/admin-auth";

type Context = { params: Promise<{ id: string }> };

async function update(req: Request, { params }: Context) {
  const denied = await requireAdminApi(req);
  if (denied) return denied;

  const { id } = await params;
  if (!/^[1-9][0-9]*$/.test(id)) return Response.json({ detail: "Invalid track ID." }, { status: 400 });
  return proxyJson(req, fpUrl(`/tracks/${id}`));
}

export { update as PATCH, update as DELETE };
