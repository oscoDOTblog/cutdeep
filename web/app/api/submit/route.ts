import { fpUrl, proxyJson } from "../_proxy";
import { requireAdminApi } from "../../lib/admin-auth";

export async function POST(req: Request) {
  const denied = await requireAdminApi(req);
  if (denied) return denied;

  return proxyJson(req, fpUrl("/submit"));
}
