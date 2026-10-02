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
): Promise<Buffer> {
  if (!source.body) throw new HttpError("The source did not provide a response body", 502);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = source.body.getReader();
  try {
    for (;;) {
      if (signal.aborted) throw new HttpError("Cancelled", 499);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) throw new HttpError(`File is larger than the ${Math.round(limit / 1048576)} MB limit`, 413);
      chunks.push(value);
      onBytes(total);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
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
