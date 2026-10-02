import { HttpError } from "@/lib/net";
import type { TransferEvent } from "@/lib/types";

export function progressEmitter(
  emit: (event: TransferEvent) => void,
  phase: "download" | "upload",
  total: number | null,
) {
  let last = 0;
  return (bytes: number, force = false) => {
    const now = Date.now();
    if (force || now - last > 150) {
      last = now;
      emit({ type: "progress", phase, bytes, total });
    }
  };
}

export async function readAll(
  source: Response,
  limit: number,
  onBytes: (bytes: number) => void,
  signal: AbortSignal,
  expectedSize: number | null = null,
): Promise<Buffer> {
  if (!source.body) throw new HttpError("The source did not provide a response body", 502);
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("limit must be a non-negative safe integer");
  if (expectedSize !== null && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
    throw new HttpError("The source returned an invalid content length", 502);
  }
  const limitMebibytes = limit / (1024 * 1024);
  const limitLabel = limitMebibytes >= 1 ? `${Math.round(limitMebibytes)} MiB` : `${limit} bytes`;
  if (expectedSize !== null && expectedSize > limit) {
    await source.body.cancel().catch(() => {});
    throw new HttpError(`File is larger than the ${limitLabel} limit`, 413);
  }

  let capacity = expectedSize ?? Math.min(limit, 64 * 1024);
  let data = Buffer.allocUnsafe(capacity);
  let total = 0;
  const reader = source.body.getReader();
  try {
    for (;;) {
      if (signal.aborted) throw new HttpError("Cancelled", 499);
      const { done, value } = await reader.read();
      if (done) {
        if (expectedSize !== null && total !== expectedSize) {
          throw new HttpError("Source size did not match its Content-Length", 502);
        }
        break;
      }
      if (signal.aborted) throw new HttpError("Cancelled", 499);
      const required = total + value.byteLength;
      if (required > limit) throw new HttpError(`File is larger than the ${limitLabel} limit`, 413);
      if (required > capacity) {
        const nextCapacity = Math.min(limit, Math.max(required, capacity === 0 ? 64 * 1024 : capacity * 2));
        const expanded = Buffer.allocUnsafe(nextCapacity);
        data.copy(expanded, 0, 0, total);
        data = expanded;
        capacity = nextCapacity;
      }
      data.set(value, total);
      total = required;
      onBytes(total);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return data.subarray(0, total);
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new HttpError("Cancelled", 499));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new HttpError("Cancelled", 499));
    }
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

export function splitExtension(name: string): [string, string] {
  const i = name.lastIndexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
}
