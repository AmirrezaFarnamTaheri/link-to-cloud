import { safeFetch } from "../../src/lib/net.ts";
import {
  authenticateRelay,
  jsonError,
  readRelayRequest,
  relaySourceResponse,
} from "../../relay/common.mjs";

const NETLIFY_STREAM_LIMIT_BYTES = 20 * 1024 * 1024;

export default async function relay(request) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/relay") {
    return Response.json(
      { ok: true, relay: "netlify-function", maxStreamBytes: NETLIFY_STREAM_LIMIT_BYTES },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (request.method !== "POST" || url.pathname !== "/relay") return jsonError("not found", 404);

  const secret = process.env.RELAY_SHARED_SECRET;
  if (typeof secret !== "string" || secret.length < 32) return jsonError("relay is not configured", 503);
  if (!(await authenticateRelay(request, secret))) return jsonError("unauthorized", 401);

  let relayRequest;
  try {
    relayRequest = await readRelayRequest(request);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "invalid relay request", 400);
  }

  try {
    const { res, finalUrl } = await safeFetch(relayRequest.url.toString(), {
      method: relayRequest.method,
      headers: { ...relayRequest.headers, "Accept-Encoding": "identity" },
      signal: request.signal,
      timeoutMs: 25_000,
      bodyIdleTimeoutMs: 50_000,
      bypassRelay: true,
    });
    const rawLength = res.headers.get("content-length");
    if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > NETLIFY_STREAM_LIMIT_BYTES) {
      await res.body?.cancel().catch(() => {});
      return jsonError("source is larger than Netlify's 20 MB streamed response limit", 413);
    }
    return relaySourceResponse(res, finalUrl, "netlify-function", NETLIFY_STREAM_LIMIT_BYTES);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "relay request failed", 502);
  }
}

export const config = { path: "/relay" };
