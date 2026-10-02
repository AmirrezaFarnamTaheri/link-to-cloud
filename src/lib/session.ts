import crypto from "node:crypto";
import { cookies } from "next/headers";

export type Session = {
  github?: { token: string; login: string; via: "oauth" | "token" };
  google?: { token: string; refresh?: string; email: string; expiresAt: number };
};

const COOKIE = "relay_session";

function key() {
  const configured = process.env.SESSION_SECRET;
  if (process.env.NODE_ENV === "production" && (!configured || Buffer.byteLength(configured) < 32)) {
    throw new Error("SESSION_SECRET must be set to at least 32 bytes in production");
  }
  const secret = configured || "dev-only-insecure-secret-change-me";
  return crypto.createHash("sha256").update(secret).digest();
}

function seal(data: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(data), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

function unseal<T>(value: string): T | null {
  try {
    const buf = Buffer.from(value, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    const dec = Buffer.concat([d.update(buf.subarray(28)), d.final()]);
    return JSON.parse(dec.toString("utf8")) as T;
  } catch {
    return null;
  }
}

const baseOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: process.env.NODE_ENV === "production",
};

export async function getSession(): Promise<Session> {
  const store = await cookies();
  const v = store.get(COOKIE)?.value;
  return (v && unseal<Session>(v)) || {};
}

export async function saveSession(s: Session) {
  const store = await cookies();
  store.set(COOKIE, seal(s), { ...baseOpts, maxAge: 60 * 60 * 24 * 30 });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(COOKIE);
}

/** Short-lived sealed state cookie for OAuth CSRF protection. */
export async function setState(name: string, state: string) {
  const store = await cookies();
  store.set(name, seal({ state }), { ...baseOpts, maxAge: 600 });
}

export async function checkState(name: string, state: string | null) {
  const store = await cookies();
  const v = store.get(name)?.value;
  store.delete(name);
  const data = v ? unseal<{ state: string }>(v) : null;
  return !!state && !!data && data.state === state;
}

export function originOf(req: Request): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || (host?.startsWith("localhost") ? "http" : "https");
  if (host) return `${proto.split(",")[0]}://${host}`;
  return new URL(req.url).origin;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}
