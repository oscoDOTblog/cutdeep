import { fpUrl, proxyJson } from "../_proxy";

export async function POST(req: Request) {
  return proxyJson(req, fpUrl("/submit"));
}
