import { fpUrl, proxyJson } from "../../_proxy";

export async function POST(req: Request) {
  const type = req.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json" && type !== "multipart/form-data") {
    return Response.json({ detail: "Send a JSON track URL or a multipart audio file." }, { status: 415 });
  }
  return proxyJson(req, fpUrl("/catalog/imports"));
}
