import dns from "node:dns/promises";
import net from "node:net";
import { Agent } from "undici";

export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

function isPrivateIPv4(ip: string): boolean {
  if (!net.isIPv4(ip)) return true;
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function ipv6Groups(ip: string): number[] | null {
  let address = ip.toLowerCase();
  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    const ipv4 = address.slice(lastColon + 1);
    if (!net.isIPv4(ipv4)) return null;
    const [a, b, c, d] = ipv4.split(".").map(Number);
    address = `${address.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const compressedAt = address.indexOf("::");
  if (compressedAt !== address.lastIndexOf("::")) return null;
  const left = (compressedAt < 0 ? address : address.slice(0, compressedAt)).split(":").filter(Boolean);
  const right = compressedAt < 0 ? [] : address.slice(compressedAt + 2).split(":").filter(Boolean);
  const zeroCount = compressedAt < 0 ? 0 : 8 - left.length - right.length;
  if ((compressedAt < 0 && left.length !== 8) || (compressedAt >= 0 && zeroCount < 1)) return null;
  const parts = [...left, ...Array.from({ length: zeroCount }, () => "0"), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[\da-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (!net.isIPv6(ip)) return true;

  const groups = ipv6Groups(ip);
  if (!groups) return true;

  // Only globally routable unicast IPv6 addresses (2000::/3) are accepted.
  // This also blocks loopback, link-local, unique-local, multicast, and mapped IPv4 forms.
  if ((groups[0] & 0xe000) !== 0x2000) return true;

  // Conservatively exclude IANA special-purpose, documentation, and IPv6 transition space from user-controlled sources.
  if (groups[0] === 0x2001 && (groups[1] & 0xfe00) === 0) return true; // 2001::/23 IETF assignments, including Teredo
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation
  if (groups[0] === 0x2001 && groups[1] === 0x0002 && groups[2] === 0x0000) return true; // 2001:2::/48 benchmarking
  if (groups[0] === 0x2001 && groups[1] === 0x0010 && (groups[2] & 0xfff0) === 0) return true; // deprecated ORCHID
  if (groups[0] === 0x2001 && groups[1] === 0x0020 && (groups[2] & 0xfff0) === 0) return true; // ORCHIDv2
  if (groups[0] === 0x5f00) return true; // 5f00::/16 Segment Routing SIDs
  if (groups[0] === 0x3fff && (groups[1] & 0xf000) === 0) return true; // 3fff::/20 documentation
  if (groups[0] === 0x2002) return true;
  return false;
}

type ResolvedAddress = { address: string; family: number };

async function resolvePublicAddresses(u: URL): Promise<ResolvedAddress[]> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new HttpError("Only http(s) links are supported");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = net.isIP(host)
    ? [{ address: host, family: net.isIPv4(host) ? 4 : 6 }]
    : await dns.lookup(host, { all: true, verbatim: true }).catch(() => []);
  if (!addrs.length) throw new HttpError("Could not resolve host");
  if (addrs.some((address) => isPrivateIp(address.address))) {
    throw new HttpError("Private, non-public, or special-use addresses are not allowed");
  }
  return addrs;
}

export async function assertPublic(u: URL) {
  await resolvePublicAddresses(u);
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

function pinnedDispatcher(expectedHostname: string, addresses: ResolvedAddress[]): Agent {
  const expected = expectedHostname.toLowerCase().replace(/\.$/, "");
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        if (hostname.toLowerCase().replace(/\.$/, "") !== expected) {
          const error = Object.assign(new Error("The connection hostname was not validated"), { code: "ENOTFOUND" });
          callback(error, "", 0);
          return;
        }
        const candidates = addresses.filter((address) => !options.family || options.family === address.family);
        if (!candidates.length) {
          const error = Object.assign(new Error("No validated address for the requested IP family"), { code: "ENOTFOUND" });
          callback(error, "", 0);
          return;
        }
        if (options.all) callback(null, candidates);
        else callback(null, candidates[0].address, candidates[0].family);
      },
    },
  });
}

function responseWithCleanup(
  res: Response,
  cleanup: () => Promise<void>,
  onFailure: (error: unknown) => void,
  idleTimeoutMs: number,
): Response {
  if (!res.body) return res;
  const reader = res.body.getReader();
  let closePromise: Promise<void> | undefined;
  const close = () => {
    closePromise ??= cleanup().catch(() => {});
    return closePromise;
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new HttpError("The source stopped sending data", 502)), idleTimeoutMs);
          }),
        ]);
        if (result.done) {
          void close();
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        onFailure(error);
        await reader.cancel(error).catch(() => {});
        void close();
        controller.error(error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    async cancel(reason) {
      onFailure(reason);
      try {
        await reader.cancel(reason);
      } finally {
        await close();
      }
    },
  }, { highWaterMark: 0 });
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * Fetch with manually checked and pinned public addresses, SSRF-checked redirects, header and body-idle timeouts.
 * Custom headers are only sent to the original origin.
 */
export async function safeFetch(
  link: string,
  opts: {
    headers?: Record<string, string>;
    method?: "GET" | "HEAD";
    signal?: AbortSignal;
    timeoutMs?: number;
    bodyIdleTimeoutMs?: number;
    fetcher?: typeof fetch;
  } = {},
): Promise<{ res: Response; finalUrl: URL }> {
  let u = new URL(normalizeUrl(link));
  const firstOrigin = u.origin;
  const fetcher = opts.fetcher ?? fetch;
  for (let i = 0; i < 8; i++) {
    const addresses = await resolvePublicAddresses(u);
    const hostname = u.hostname.replace(/^\[|\]$/g, "");
    const dispatcher = pinnedDispatcher(hostname, addresses);
    const headerTimeout = new AbortController();
    const signal = opts.signal
      ? AbortSignal.any([headerTimeout.signal, opts.signal])
      : headerTimeout.signal;
    const timer = setTimeout(() => headerTimeout.abort(new Error("timeout")), opts.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await fetcher(u, {
        method: opts.method ?? "GET",
        redirect: "manual",
        signal,
        dispatcher,
        headers: {
          "User-Agent": "Relay/1.0 (+link-to-cloud)",
          Accept: "*/*",
          ...(u.origin === firstOrigin ? opts.headers : {}),
        },
      } as RequestInit);
    } catch (error) {
      await dispatcher.destroy(error instanceof Error ? error : new Error("Source request failed")).catch(() => {});
      if (opts.signal?.aborted) throw error;
      throw new HttpError(
        headerTimeout.signal.aborted ? "The source server took too long to respond" : "Could not reach the source server",
        502,
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel().catch(() => {});
      await dispatcher.close().catch(() => {});
      headerTimeout.abort(new Error("redirect complete"));
      u = new URL(res.headers.get("location")!, u);
      continue;
    }
    // The timeout only applies until response headers arrive; the caller's signal remains
    // linked to the fetch while its body is consumed, so cancelling a transfer interrupts I/O.
    if (!res.body) {
      await dispatcher.close().catch(() => {});
      return { res, finalUrl: u };
    }
    const bodyIdleTimeoutMs = opts.bodyIdleTimeoutMs ?? 120_000;
    if (!Number.isSafeInteger(bodyIdleTimeoutMs) || bodyIdleTimeoutMs < 1) {
      await res.body.cancel().catch(() => {});
      await dispatcher.close().catch(() => {});
      throw new Error("bodyIdleTimeoutMs must be a positive safe integer");
    }
    return {
      res: responseWithCleanup(res, () => dispatcher.close(), (error) => headerTimeout.abort(error), bodyIdleTimeoutMs),
      finalUrl: u,
    };
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
  const raw = res.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function mimeOf(res: Response): string {
  return (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim() || "application/octet-stream";
}
