import dns from "node:dns/promises";
import net from "node:net";

export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const l = ip.toLowerCase();
  if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

export async function assertPublic(u: URL) {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new HttpError("Only http(s) links are supported");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError("Could not resolve host");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new HttpError("Private/internal addresses are not allowed");
}

/** Rewrite popular "share page" links into direct-download links. */
export function normalizeUrl(link: string): string {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    throw new HttpError("Invalid URL");
  }
  const h = u.hostname.replace(/^www\./, "");
  if (h === "dropbox.com") {
    u.searchParams.delete("raw");
    u.searchParams.set("dl", "1");
    return u.toString();
  }
  if (h === "github.com") {
    const m = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(u.pathname);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  }
  if (h === "drive.google.com") {
    const m = /^\/file\/d\/([\w-]+)/.exec(u.pathname);
    if (m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  }
  return u.toString();
}

const BLOCKED_HEADERS = new Set(["host", "content-length", "connection", "transfer-encoding", "upgrade", "te"]);

/** Parse an optional "Name: value" line the user wants sent to the source server. */
export function parseHeaderLine(line?: string): Record<string, string> {
  if (!line?.trim()) return {};
  const i = line.indexOf(":");
  if (i < 1) throw new HttpError('Custom header must look like "Name: value"');
  const name = line.slice(0, i).trim();
  const value = line.slice(i + 1).trim();
  if (!/^[A-Za-z0-9-]+$/.test(name) || BLOCKED_HEADERS.has(name.toLowerCase())) throw new HttpError("Header name not allowed");
  if (/[\r\n]/.test(value)) throw new HttpError("Invalid header value");
  return { [name]: value };
}

/**
 * Fetch with manual, SSRF-checked redirects and a header timeout.
 * Custom headers are only sent to the original origin.
 */
export async function safeFetch(
  link: string,
  opts: { headers?: Record<string, string>; method?: "GET" | "HEAD"; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ res: Response; finalUrl: URL }> {
  let u = new URL(normalizeUrl(link));
  const firstOrigin = u.origin;
  for (let i = 0; i < 8; i++) {
    await assertPublic(u);
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    opts.signal?.addEventListener("abort", onAbort);
    if (opts.signal?.aborted) ac.abort();
    const timer = setTimeout(() => ac.abort(new Error("timeout")), opts.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await fetch(u, {
        method: opts.method ?? "GET",
        redirect: "manual",
        signal: ac.signal,
        headers: {
          "User-Agent": "Relay/1.0 (+link-to-cloud)",
          Accept: "*/*",
          ...(u.origin === firstOrigin ? opts.headers : {}),
        },
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      throw new HttpError(ac.signal.aborted ? "The source server took too long to respond" : "Could not reach the source server", 502);
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      u = new URL(res.headers.get("location")!, u);
      continue;
    }
    // Body streaming should not be cut by the header timeout, but must still honour the caller's signal.
    if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
    return { res, finalUrl: u };
  }
  throw new HttpError("Too many redirects", 502);
}

const EXT: Record<string, string> = {
  "application/zip": ".zip",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "application/gzip": ".gz",
  "application/x-tar": ".tar",
  "application/octet-stream": "",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/csv": ".csv",
  "video/mp4": ".mp4",
  "audio/mpeg": ".mp3",
};

export function sanitizeName(name: string): string {
  const n = name.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "_").replace(/^\.+/, "").trim().slice(0, 200);
  return n || "download";
}

export function guessName(res: Response, finalUrl: URL): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*=(?:UTF-8|utf-8)''([^;]+)/.exec(cd) ?? /filename="?([^";]+)"?/i.exec(cd);
  let name = "";
  if (m) {
    try {
      name = decodeURIComponent(m[1]);
    } catch {
      name = m[1];
    }
  }
  if (!name) {
    try {
      name = decodeURIComponent(finalUrl.pathname.split("/").filter(Boolean).pop() ?? "");
    } catch {}
  }
  name = sanitizeName(name || finalUrl.hostname);
  if (!/\.[A-Za-z0-9]{1,8}$/.test(name)) {
    const ext = EXT[(res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()];
    if (ext) name += ext;
  }
  return name;
}

/** Size in bytes if it can be trusted (content-length is meaningless for compressed responses). */
export function knownSize(res: Response): number | null {
  const enc = (res.headers.get("content-encoding") ?? "").toLowerCase();
  if (enc && enc !== "identity") return null;
  const n = Number(res.headers.get("content-length"));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function mimeOf(res: Response): string {
  return (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
}
