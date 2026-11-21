import "server-only";

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE = "cutdeep_admin";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const PROTECTED_PAGES = new Set(["/upload", "/settings", "/settings/tracks", "/settings/scans"]);

export function adminDestination(value: unknown): string {
  return typeof value === "string" && PROTECTED_PAGES.has(value) ? value : "/settings";
}

export function adminPasswordConfigured(): boolean {
  return Boolean(process.env.CUTDEEP_ADMIN_PASSWORD);
}

function passwordMatches(candidate: string, password: string): boolean {
  return timingSafeEqual(
    createHash("sha256").update(candidate).digest(),
    createHash("sha256").update(password).digest(),
  );
}

function signature(payload: string, password: string): string {
  return createHmac("sha256", password).update("cutdeep-admin-session:").update(payload).digest("base64url");
}

function sessionIsValid(token: string | undefined, password: string): boolean {
  const parts = /^(\d{1,12}\.[\w-]{22})\.([\w-]{43})$/.exec(token ?? "");
  if (!parts || Number(parts[1].split(".")[0]) <= Math.floor(Date.now() / 1000)) return false;
  return timingSafeEqual(Buffer.from(parts[2]), Buffer.from(signature(parts[1], password)));
}

export async function adminUnlocked(): Promise<boolean> {
  const token = (await cookies()).get(COOKIE)?.value;
  const password = process.env.CUTDEEP_ADMIN_PASSWORD;
  return !password || sessionIsValid(token, password);
}

export async function requireAdminPage(destination: string): Promise<void> {
  if (!(await adminUnlocked())) redirect(`/unlock?next=${encodeURIComponent(destination)}`);
}

export async function startAdminSession(candidate: unknown): Promise<boolean> {
  const password = process.env.CUTDEEP_ADMIN_PASSWORD;
  if (!password) return true;
  if (typeof candidate !== "string" || !passwordMatches(candidate, password)) return false;

  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${expires}.${randomBytes(16).toString("base64url")}`;
  const protocol = (await headers()).get("x-forwarded-proto")?.split(",")[0].trim();
  (await cookies()).set(COOKIE, `${payload}.${signature(payload, password)}`, {
    httpOnly: true,
    sameSite: "strict",
    secure: protocol === "https",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return true;
}

export async function endAdminSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function requireAdminApi(request: Request): Promise<Response | null> {
  const password = process.env.CUTDEEP_ADMIN_PASSWORD;
  if (!password) return null;

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ") && passwordMatches(authorization.slice(7), password)) return null;

  const site = request.headers.get("sec-fetch-site");
  if ((!site || site === "same-origin" || site === "none") && await adminUnlocked()) return null;

  return Response.json({ detail: "Unlock Upload or Settings to continue." }, {
    status: 401,
    headers: { "Cache-Control": "no-store" },
  });
}
