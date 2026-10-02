import crypto from "node:crypto";
import { isIP } from "node:net";
import { cookies } from "next/headers";

export type Session = {
  github?: { token: string; login: string; id?: number; via: "oauth" | "token" };
  google?: { token: string; refresh?: string; email: string; sub?: string; expiresAt: number };
  onedrive?: { token: string; refresh?: string; id: string; name: string; expiresAt: number };
  dropbox?: { token: string; refresh?: string; accountId: string; name: string; expiresAt: number };
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

function parseOrigin(value: string, production: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("APP_ORIGIN must be an absolute HTTP(S) origin");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("APP_ORIGIN must be an origin only (scheme and host, without a path)");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (production && url.protocol !== "https:" && !local) {
    throw new Error("APP_ORIGIN must use HTTPS in production");
  }
  return url.origin;
}

/** Canonical public origin used for OAuth callbacks and same-origin mutation checks. */
export function originOf(req: Request): string {
  const configured = process.env.APP_ORIGIN?.trim();
  if (process.env.NODE_ENV === "production" && !configured) {
    throw new Error("APP_ORIGIN is required in production");
  }
  if (configured) return parseOrigin(configured, process.env.NODE_ENV === "production");

  const requestUrl = new URL(req.url);
  const fallback = requestUrl.protocol === "http:" || requestUrl.protocol === "https:" ? requestUrl.origin : null;
  const forwardedHost = req.headers.get("x-forwarded-host")?.split(",", 1)[0].trim();
  const host = forwardedHost || req.headers.get("host")?.split(",", 1)[0].trim();
  const forwardedProto = req.headers.get("x-forwarded-proto")?.split(",", 1)[0].trim().toLowerCase();
  const protocol = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : requestUrl.protocol.slice(0, -1);

  if (host && (protocol === "http" || protocol === "https")) {
    try {
      const candidate = new URL(`${protocol}://${host}`);
      if (!candidate.username && !candidate.password && candidate.pathname === "/" && !candidate.search && !candidate.hash) {
        return candidate.origin;
      }
    } catch {
      // Ignore malformed forwarded/host values and fall back to the request URL.
    }
  }
  if (fallback) return fallback;
  throw new Error("Could not determine the application origin");
}

/** Reject browser state changes initiated by a different origin; non-browser clients may omit Origin. */
export function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  try {
    const parsed = new URL(origin);
    return parsed.origin !== "null" && parsed.origin === originOf(req);
  } catch {
    return false;
  }
}

/**
 * Read the rightmost valid address because trusted ingress should append values after any
 * client-supplied prefix. Proxy chains differ, so this is only a best-effort rate-limit key,
 * never a verified client identity or authorization signal.
 */
export function clientIp(req: Request): string {
  const trustedHeader = process.env.CLIENT_IP_HEADER?.trim();
  if (trustedHeader) {
    try {
      const address = req.headers.get(trustedHeader)?.trim();
      return address && isIP(address) ? address.toLowerCase() : "unknown";
    } catch {
      return "unknown";
    }
  }

  const chain = req.headers.get("x-forwarded-for")?.split(",") ?? [];
  for (let index = chain.length - 1; index >= 0; index--) {
    const address = chain[index].trim();
    if (isIP(address)) return address.toLowerCase();
  }
  return "unknown";
}
