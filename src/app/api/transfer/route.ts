import { recordTransfer } from "@/lib/history";
import { HttpError, guessName, knownSize, mimeOf, parseHeaderLine, safeFetch, sanitizeName } from "@/lib/net";
import { getProvider } from "@/lib/providers/registry";
import { acquireTransferSlot } from "@/lib/providers/slots";
import type { ProviderCredentials, ProviderTransferContext } from "@/lib/providers/types";
import { allow } from "@/lib/ratelimit";
import { clientIp, getSession, isSameOriginRequest } from "@/lib/session";
import { readTransferRequest } from "@/lib/transfer-request";
import type { TransferEvent, TransferRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function jsonError(error: string, status: number) {
  return Response.json({ type: "error", error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return jsonError("Cross-origin request rejected", 403);
  if (!allow(`transfer:${clientIp(req)}`, 60, 10 * 60_000)) {
    return jsonError("Too many transfers — try again in a few minutes", 429);
  }

  let request: TransferRequest;
  let headers: Record<string, string>;
  try {
    request = await readTransferRequest(req);
    headers = parseHeaderLine(request.header);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return jsonError(error instanceof Error ? error.message : "Invalid transfer request", status);
  }

  const providerId = request.target.startsWith("plugin:") ? request.target.slice("plugin:".length) : request.target;
  const provider = getProvider(providerId);
  if (!provider) return jsonError("Unsupported destination", 400);

  let credentials: ProviderCredentials | null;
  try {
    credentials = await provider.resolveCredentials(await getSession());
  } catch {
    return jsonError(`Could not authenticate with ${provider.displayName}`, 502);
  }
  if (!credentials) return jsonError(`Log in to ${provider.displayName} first`, 401);
  const releaseSlot = acquireTransferSlot(provider.id);
  if (!releaseSlot) {
    return Response.json(
      { type: "error", error: `${provider.displayName} is at transfer capacity; retry shortly` },
      { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } },
    );
  }

  const abortController = new AbortController();
  const onRequestAbort = () => abortController.abort();
  req.signal.addEventListener("abort", onRequestAbort, { once: true });
  if (req.signal.aborted) abortController.abort();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: TransferEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The browser has disconnected; the stream's cancel callback aborts the transfer.
        }
      };
      const startedAt = Date.now();
      let name = request.filename?.trim() ? sanitizeName(request.filename) : "";
      let source: Response | null = null;

      try {
        emit({ type: "phase", phase: "connecting" });
        const fetched = await safeFetch(request.url, { headers, signal: abortController.signal });
        source = fetched.res;
        if (!source.ok || !source.body) {
          await source.body?.cancel().catch(() => {});
          throw new HttpError(`Source responded with ${source.status}`, 502);
        }
        name ||= guessName(source, fetched.finalUrl);
        const size = knownSize(source);
        emit({ type: "start", name, size, mime: mimeOf(source) });

        const context: ProviderTransferContext = {
          request,
          source,
          name,
          size,
          emit,
          signal: abortController.signal,
        };
        const done = await provider.uploadFile(context, credentials);
        emit({ type: "done", ...done });
        await recordTransfer({
          owner: credentials.owner,
          target: provider.id,
          status: done.skipped ? "skipped" : "success",
          fileName: done.name,
          sourceUrl: request.url,
          location: done.location,
          resultUrl: done.url,
          bytes: done.bytes,
          sha256: done.sha256,
          durationMs: done.durationMs,
        });
      } catch (error) {
        await source?.body?.cancel().catch(() => {});
        const cancelled = abortController.signal.aborted;
        const message = cancelled ? "Cancelled" : error instanceof Error ? error.message : "Transfer failed";
        emit({ type: "error", error: message });
        await recordTransfer({
          owner: credentials.owner,
          target: provider.id,
          status: cancelled ? "cancelled" : "failed",
          fileName: name || "download",
          sourceUrl: request.url,
          error: message,
          durationMs: Date.now() - startedAt,
        });
      } finally {
        releaseSlot();
        req.signal.removeEventListener("abort", onRequestAbort);
        try {
          controller.close();
        } catch {
          // A cancelled response stream is already closed.
        }
      }
    },
    cancel() {
      abortController.abort();
      req.signal.removeEventListener("abort", onRequestAbort);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
