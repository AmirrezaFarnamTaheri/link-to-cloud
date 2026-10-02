import { HttpError } from "@/lib/net";

/**
 * Reads a web stream in bounded pieces without prefetching beyond one source
 * chunk. The caller owns `cancel`/`release` in a finally block.
 */
export class ChunkReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private pending: Uint8Array | null = null;
  private pendingOffset = 0;
  private ended = false;

  constructor(source: ReadableStream<Uint8Array>) {
    this.reader = source.getReader();
  }

  async read(maxBytes: number, signal: AbortSignal): Promise<{ data: Uint8Array; ended: boolean }> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Chunk size must be a positive safe integer");
    const output = new Uint8Array(maxBytes);
    let length = 0;
    while (length < maxBytes && !this.ended) {
      this.assertActive(signal);
      if (this.pending && this.pendingOffset < this.pending.byteLength) {
        const count = Math.min(maxBytes - length, this.pending.byteLength - this.pendingOffset);
        output.set(this.pending.subarray(this.pendingOffset, this.pendingOffset + count), length);
        this.pendingOffset += count;
        length += count;
        continue;
      }
      this.pending = null;
      this.pendingOffset = 0;
      const next = await this.reader.read();
      this.assertActive(signal);
      if (next.done) {
        this.ended = true;
        break;
      }
      if (next.value.byteLength) this.pending = next.value;
    }
    return { data: output.subarray(0, length), ended: this.ended };
  }

  async hasMore(signal: AbortSignal): Promise<boolean> {
    while (!this.ended) {
      this.assertActive(signal);
      if (this.pending && this.pendingOffset < this.pending.byteLength) return true;
      this.pending = null;
      this.pendingOffset = 0;
      const next = await this.reader.read();
      this.assertActive(signal);
      if (next.done) {
        this.ended = true;
        return false;
      }
      if (next.value.byteLength) {
        this.pending = next.value;
        return true;
      }
    }
    return false;
  }

  async cancel(reason?: unknown) {
    await this.reader.cancel(reason).catch(() => {});
  }

  release() {
    this.reader.releaseLock();
  }

  private assertActive(signal: AbortSignal) {
    if (signal.aborted) throw new HttpError("Cancelled", 499);
  }
}

export function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw new HttpError("Cancelled", 499);
}
