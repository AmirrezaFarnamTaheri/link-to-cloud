import { createHash } from "node:crypto";
import { HttpError } from "@/lib/net";
import type { TransferEvent } from "@/lib/types";
import { withTimeout } from "@/lib/timeouts";
import { abortableSleep, progressEmitter } from "./shared";

export const DRIVE_CHUNK_SIZE = 8 * 1024 * 1024;
const DRIVE_CHUNK_ALIGNMENT = 256 * 1024;
const MAX_CHUNK_ATTEMPTS = 4;

type DriveFile = { id: string; webViewLink?: string };
type UploadStatus = { completed: true; file: DriveFile } | { completed: false; acknowledgedEnd: number };
type Fetcher = typeof fetch;

type UploadOptions = {
  sessionUrl: string;
  source: ReadableStream<Uint8Array>;
  expectedSize: number | null;
  mime: string;
  signal: AbortSignal;
  emit: (event: TransferEvent) => void;
  fetcher?: Fetcher;
};

class SourceReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private pending: Uint8Array | null = null;
  private pendingOffset = 0;
  private ended = false;

  constructor(source: ReadableStream<Uint8Array>) {
    this.reader = source.getReader();
  }

  async read(maxBytes: number, signal: AbortSignal): Promise<{ data: Uint8Array; ended: boolean }> {
    const output = new Uint8Array(maxBytes);
    let length = 0;
    while (length < maxBytes && !this.ended) {
      assertNotAborted(signal);
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
      assertNotAborted(signal);
      if (next.done) {
        this.ended = true;
        break;
      }
      if (next.value.byteLength > 0) {
        this.pending = next.value;
      }
    }
    return { data: output.subarray(0, length), ended: this.ended };
  }

  async hasMore(signal: AbortSignal): Promise<boolean> {
    while (!this.ended) {
      assertNotAborted(signal);
      if (this.pending && this.pendingOffset < this.pending.byteLength) return true;
      this.pending = null;
      this.pendingOffset = 0;
      const next = await this.reader.read();
      assertNotAborted(signal);
      if (next.done) {
        this.ended = true;
        return false;
      }
      if (next.value.byteLength > 0) {
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
}

function assertNotAborted(signal: AbortSignal) {
  if (signal.aborted) throw new HttpError("Cancelled", 499);
}

function validateSessionUrl(sessionUrl: string): string {
  let url: URL;
  try {
    url = new URL(sessionUrl);
  } catch {
    throw new HttpError("Google Drive returned an invalid resumable upload URL", 502);
  }
  if (
    url.origin !== "https://www.googleapis.com" ||
    url.username ||
    url.password ||
    url.pathname !== "/upload/drive/v3/files"
  ) {
    throw new HttpError("Google Drive returned an untrusted resumable upload URL", 502);
  }
  return url.toString();
}

function parseAcknowledgedEnd(range: string | null): number {
  if (!range) return -1;
  const match = /^bytes=0-(\d+)$/.exec(range.trim());
  if (!match) throw new HttpError("Google Drive returned an invalid upload range", 502);
  const end = Number(match[1]);
  if (!Number.isSafeInteger(end) || end < 0) throw new HttpError("Google Drive returned an invalid upload range", 502);
  return end;
}

async function readDriveFile(response: Response): Promise<DriveFile> {
  const body = (await response.json().catch(() => null)) as { id?: unknown; webViewLink?: unknown } | null;
  if (!body || typeof body.id !== "string" || !body.id) {
    throw new HttpError("Google Drive did not return uploaded file metadata", 502);
  }
  return {
    id: body.id,
    ...(typeof body.webViewLink === "string" ? { webViewLink: body.webViewLink } : {}),
  };
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: unknown } } | null;
  const message = body?.error?.message;
  return typeof message === "string" && message ? message.slice(0, 500) : `HTTP ${response.status}`;
}

async function readResponseStatus(response: Response): Promise<UploadStatus> {
  if (response.status === 200 || response.status === 201) {
    return { completed: true, file: await readDriveFile(response) };
  }
  if (response.status === 308) {
    const acknowledgedEnd = parseAcknowledgedEnd(response.headers.get("range"));
    await response.body?.cancel().catch(() => {});
    return { completed: false, acknowledgedEnd };
  }
  const message = await errorMessage(response);
  throw new HttpError(`Google Drive upload status check failed: ${message}`, response.status === 401 ? 401 : 502);
}

async function queryUploadStatus(
  sessionUrl: string,
  expectedSize: number | null,
  signal: AbortSignal,
  fetcher: Fetcher,
): Promise<UploadStatus> {
  assertNotAborted(signal);
  let response: Response;
  try {
    response = await fetcher(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Length": "0",
        "Content-Range": `bytes */${expectedSize === null ? "*" : expectedSize}`,
      },
      body: new Uint8Array(),
      redirect: "manual",
      signal: withTimeout(signal, 15_000),
    });
  } catch {
    if (signal.aborted) throw new HttpError("Cancelled", 499);
    throw new HttpError("Could not check Google Drive upload status", 502);
  }
  return readResponseStatus(response);
}

function ensureAcknowledgement(
  acknowledgedEnd: number,
  requestStart: number,
  chunkEnd: number,
  final: boolean,
): number {
  const nextOffset = acknowledgedEnd + 1;
  if (nextOffset < requestStart || nextOffset > chunkEnd + 1) {
    throw new HttpError("Google Drive acknowledged bytes outside the current upload chunk", 502);
  }
  if (!final && nextOffset > requestStart && (nextOffset - requestStart) % DRIVE_CHUNK_ALIGNMENT !== 0) {
    throw new HttpError("Google Drive acknowledged a non-aligned resumable chunk", 502);
  }
  return nextOffset;
}

async function uploadChunk({
  sessionUrl,
  chunk,
  start,
  expectedSize,
  final,
  mime,
  signal,
  fetcher,
  emit,
}: {
  sessionUrl: string;
  chunk: Uint8Array;
  start: number;
  expectedSize: number | null;
  final: boolean;
  mime: string;
  signal: AbortSignal;
  fetcher: Fetcher;
  emit: (event: TransferEvent) => void;
}): Promise<DriveFile | null> {
  const end = start + chunk.byteLength - 1;
  let nextOffset = start;
  const progress = progressEmitter(emit, "upload", expectedSize);

  for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS; attempt++) {
    assertNotAborted(signal);
    const body = chunk.subarray(nextOffset - start);
    const headers: Record<string, string> = {
      "Content-Length": String(body.byteLength),
      "Content-Type": mime,
    };
    if (body.byteLength > 0) {
      headers["Content-Range"] = `bytes ${nextOffset}-${end}/${final ? start + chunk.byteLength : expectedSize ?? "*"}`;
    }

    let response: Response;
    try {
      response = await fetcher(sessionUrl, {
        method: "PUT",
        headers,
        body: body as unknown as BodyInit,
        redirect: "manual",
        signal: withTimeout(signal, 120_000),
      });
    } catch {
      if (signal.aborted) throw new HttpError("Cancelled", 499);
      const status = await queryUploadStatus(sessionUrl, final ? start + chunk.byteLength : expectedSize, signal, fetcher);
      if (status.completed) {
        if (!final) throw new HttpError("Google Drive completed an upload before the source ended", 502);
        progress(start + chunk.byteLength, true);
        return status.file;
      }
      nextOffset = ensureAcknowledgement(status.acknowledgedEnd, start, end, final);
      if (nextOffset === end + 1) {
        if (final) throw new HttpError("Google Drive accepted the final bytes but did not finalize the file", 502);
        progress(nextOffset, true);
        return null;
      }
      if (attempt + 1 === MAX_CHUNK_ATTEMPTS) throw new HttpError("Google Drive upload connection was interrupted", 502);
      await abortableSleep(200 * (attempt + 1), signal);
      continue;
    }

    if (response.status === 200 || response.status === 201) {
      if (!final) {
        await response.body?.cancel().catch(() => {});
        throw new HttpError("Google Drive completed an upload before the source ended", 502);
      }
      progress(start + chunk.byteLength, true);
      return readDriveFile(response);
    }

    if (response.status === 308) {
      const acknowledgedEnd = parseAcknowledgedEnd(response.headers.get("range"));
      await response.body?.cancel().catch(() => {});
      nextOffset = ensureAcknowledgement(acknowledgedEnd, start, end, final);
      if (nextOffset === end + 1) {
        if (final) {
          const status = await queryUploadStatus(sessionUrl, start + chunk.byteLength, signal, fetcher);
          if (status.completed) {
            progress(nextOffset, true);
            return status.file;
          }
          throw new HttpError("Google Drive accepted the final bytes but did not finalize the file", 502);
        }
        progress(nextOffset, true);
        return null;
      }
      if (attempt + 1 < MAX_CHUNK_ATTEMPTS) {
        await abortableSleep(100 * (attempt + 1), signal);
        continue;
      }
      throw new HttpError("Google Drive did not accept the complete upload chunk", 502);
    }

    if (response.status >= 500 || response.status === 429) {
      await response.body?.cancel().catch(() => {});
      const status = await queryUploadStatus(sessionUrl, final ? start + chunk.byteLength : expectedSize, signal, fetcher);
      if (status.completed) {
        if (!final) throw new HttpError("Google Drive completed an upload before the source ended", 502);
        progress(start + chunk.byteLength, true);
        return status.file;
      }
      nextOffset = ensureAcknowledgement(status.acknowledgedEnd, start, end, final);
      if (nextOffset === end + 1) {
        if (final) throw new HttpError("Google Drive accepted the final bytes but did not finalize the file", 502);
        progress(nextOffset, true);
        return null;
      }
      if (attempt + 1 === MAX_CHUNK_ATTEMPTS) throw new HttpError("Google Drive is temporarily unavailable", 502);
      await abortableSleep(200 * (attempt + 1), signal);
      continue;
    }

    const message = await errorMessage(response);
    throw new HttpError(`Google Drive upload failed: ${message}`, response.status === 401 ? 401 : 502);
  }

  throw new HttpError("Google Drive upload retry limit was reached", 502);
}

/**
 * Transfers a source stream into a Drive resumable session with at most one
 * 8 MiB application chunk in memory. The source is only read again after the
 * current chunk has been acknowledged by Drive, preserving backpressure.
 */
export async function uploadResumableStream({
  sessionUrl: untrustedSessionUrl,
  source,
  expectedSize,
  mime,
  signal,
  emit,
  fetcher = fetch,
}: UploadOptions): Promise<{ file: DriveFile; bytes: number; sha256: string }> {
  if (expectedSize !== null && (!Number.isSafeInteger(expectedSize) || expectedSize < 0)) {
    throw new HttpError("Invalid source content length", 502);
  }
  const sessionUrl = validateSessionUrl(untrustedSessionUrl);
  const sourceReader = new SourceReader(source);
  const hash = createHash("sha256");
  let bytes = 0;
  let completed = false;
  const progress = progressEmitter(emit, "upload", expectedSize);

  try {
    if (expectedSize === 0) {
      const probe = await sourceReader.read(1, signal);
      if (probe.data.byteLength !== 0 || !probe.ended) {
        throw new HttpError("The source content length did not match its body", 502);
      }
      const file = await uploadChunk({
        sessionUrl,
        chunk: new Uint8Array(),
        start: 0,
        expectedSize: 0,
        final: true,
        mime,
        signal,
        fetcher,
        emit,
      });
      if (!file) throw new HttpError("Google Drive did not finalize the empty file", 502);
      progress(0, true);
      completed = true;
      return { file, bytes: 0, sha256: hash.digest("hex") };
    }

    if (expectedSize !== null) {
      while (bytes < expectedSize) {
        const length = Math.min(DRIVE_CHUNK_SIZE, expectedSize - bytes);
        const read = await sourceReader.read(length, signal);
        if (read.data.byteLength !== length) throw new HttpError("The source content length did not match its body", 502);
        const final = bytes + length === expectedSize;
        if (final && (await sourceReader.hasMore(signal))) {
          throw new HttpError("The source content length did not match its body", 502);
        }
        hash.update(read.data);
        const file = await uploadChunk({
          sessionUrl,
          chunk: read.data,
          start: bytes,
          expectedSize,
          final,
          mime,
          signal,
          fetcher,
          emit,
        });
        bytes += length;
        if (final) {
          if (!file) throw new HttpError("Google Drive did not finalize the upload", 502);
          completed = true;
          return { file, bytes, sha256: hash.digest("hex") };
        }
      }
      throw new HttpError("The source stream ended before the expected file size", 502);
    }

    for (;;) {
      const read = await sourceReader.read(DRIVE_CHUNK_SIZE, signal);
      const chunk = read.data;
      if (chunk.byteLength === 0 && read.ended) {
        if (bytes !== 0) throw new HttpError("The source stream ended without a final resumable chunk", 502);
        const file = await uploadChunk({
          sessionUrl,
          chunk: new Uint8Array(),
          start: 0,
          expectedSize: null,
          final: true,
          mime,
          signal,
          fetcher,
          emit,
        });
        if (!file) throw new HttpError("Google Drive did not finalize the empty file", 502);
        progress(0, true);
        completed = true;
        return { file, bytes: 0, sha256: hash.digest("hex") };
      }

      let final = read.ended;
      if (!final && chunk.byteLength === DRIVE_CHUNK_SIZE) final = !(await sourceReader.hasMore(signal));
      if (!final && chunk.byteLength !== DRIVE_CHUNK_SIZE) {
        throw new HttpError("Could not determine the final source chunk", 502);
      }
      hash.update(chunk);
      const total = bytes + chunk.byteLength;
      const file = await uploadChunk({
        sessionUrl,
        chunk,
        start: bytes,
        expectedSize: final ? total : null,
        final,
        mime,
        signal,
        fetcher,
        emit,
      });
      bytes = total;
      if (final) {
        if (!file) throw new HttpError("Google Drive did not finalize the upload", 502);
        completed = true;
        return { file, bytes, sha256: hash.digest("hex") };
      }
    }
  } finally {
    if (!completed) await sourceReader.cancel(signal.aborted ? "Cancelled" : "Upload failed");
    sourceReader.release();
  }
}
