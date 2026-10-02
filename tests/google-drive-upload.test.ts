import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { DRIVE_CHUNK_SIZE, uploadResumableStream } from "../src/lib/providers/google-drive-upload";
import type { TransferEvent } from "../src/lib/types";

const sessionUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test";

function streamFrom(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function finalResponse(id = "file-1") {
  return new Response(JSON.stringify({ id, webViewLink: `https://drive.google.com/file/d/${id}/view` }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });
}

test("unknown-length streams upload as aligned intermediate chunks and a sized final chunk", async () => {
  const content = new Uint8Array(DRIVE_CHUNK_SIZE + 19);
  for (let i = 0; i < content.byteLength; i++) content[i] = i % 251;
  const ranges: string[] = [];
  const bodies: Uint8Array[] = [];
  const fetcher: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    ranges.push(headers.get("content-range") ?? "");
    bodies.push(new Uint8Array(init?.body as Uint8Array));
    if (init?.body instanceof Uint8Array && headers.get("content-range")?.endsWith("/*")) {
      return new Response(null, {
        status: 308,
        headers: { Range: `bytes=0-${DRIVE_CHUNK_SIZE - 1}` },
      });
    }
    return finalResponse();
  };

  const result = await uploadResumableStream({
    sessionUrl,
    source: streamFrom([content.subarray(0, 900_000), content.subarray(900_000)]),
    expectedSize: null,
    mime: "application/octet-stream",
    signal: new AbortController().signal,
    emit: () => {},
    fetcher,
  });

  assert.deepEqual(ranges, [
    `bytes 0-${DRIVE_CHUNK_SIZE - 1}/*`,
    `bytes ${DRIVE_CHUNK_SIZE}-${content.byteLength - 1}/${content.byteLength}`,
  ]);
  assert.equal(bodies[0].byteLength, DRIVE_CHUNK_SIZE);
  assert.equal(bodies[1].byteLength, 19);
  assert.equal(result.bytes, content.byteLength);
  assert.equal(result.sha256, createHash("sha256").update(content).digest("hex"));
  assert.equal(result.file.id, "file-1");
});

test("unknown-length streams ending exactly on a chunk boundary finalize that chunk", async () => {
  const content = new Uint8Array(DRIVE_CHUNK_SIZE).fill(0x5a);
  let range = "";
  const result = await uploadResumableStream({
    sessionUrl,
    source: streamFrom([content]),
    expectedSize: null,
    mime: "application/octet-stream",
    signal: new AbortController().signal,
    emit: () => {},
    fetcher: async (_input, init) => {
      range = new Headers(init?.headers).get("content-range") ?? "";
      return finalResponse("exact-boundary");
    },
  });

  assert.equal(range, `bytes 0-${content.byteLength - 1}/${content.byteLength}`);
  assert.equal(result.bytes, content.byteLength);
  assert.equal(result.file.id, "exact-boundary");
});

test("zero-byte sources use an empty final resumable request", async () => {
  let observedLength: string | null = null;
  let observedRange: string | null = null;
  const result = await uploadResumableStream({
    sessionUrl,
    source: streamFrom([]),
    expectedSize: 0,
    mime: "application/octet-stream",
    signal: new AbortController().signal,
    emit: () => {},
    fetcher: async (_input, init) => {
      const headers = new Headers(init?.headers);
      observedLength = headers.get("content-length");
      observedRange = headers.get("content-range");
      return finalResponse("empty-file");
    },
  });

  assert.equal(observedLength, "0");
  assert.equal(observedRange, null);
  assert.equal(result.bytes, 0);
  assert.equal(result.sha256, createHash("sha256").digest("hex"));
});

test("known source lengths are checked before the final chunk is committed", async () => {
  let uploadRequests = 0;
  await assert.rejects(
    uploadResumableStream({
      sessionUrl,
      source: streamFrom([new Uint8Array([1, 2, 3])]),
      expectedSize: 4,
      mime: "application/octet-stream",
      signal: new AbortController().signal,
      emit: () => {},
      fetcher: async () => {
        uploadRequests++;
        return finalResponse();
      },
    }),
    /content length did not match/i,
  );
  assert.equal(uploadRequests, 0);
});

test("interrupted final chunks query Drive and continue at its acknowledged byte offset", async () => {
  const content = new Uint8Array(600_000).map((_, i) => i % 251);
  const requests: { range: string | null; bytes: number; method: string }[] = [];
  let firstUpload = true;
  const fetcher: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    const body = init?.body as Uint8Array;
    const range = headers.get("content-range");
    requests.push({ range, bytes: body.byteLength, method: init?.method ?? "" });
    if (firstUpload) {
      firstUpload = false;
      throw new Error("connection dropped after partial acceptance");
    }
    if (range === `bytes */${content.byteLength}`) {
      return new Response(null, { status: 308, headers: { Range: "bytes=0-262143" } });
    }
    assert.equal(range, `bytes 262144-${content.byteLength - 1}/${content.byteLength}`);
    return finalResponse("resumed-file");
  };
  const events: TransferEvent[] = [];
  const result = await uploadResumableStream({
    sessionUrl,
    source: streamFrom([content]),
    expectedSize: content.byteLength,
    mime: "application/octet-stream",
    signal: new AbortController().signal,
    emit: (event) => events.push(event),
    fetcher,
  });

  assert.deepEqual(requests.map((request) => request.range), [
    `bytes 0-${content.byteLength - 1}/${content.byteLength}`,
    `bytes */${content.byteLength}`,
    `bytes 262144-${content.byteLength - 1}/${content.byteLength}`,
  ]);
  assert.equal(requests[2].bytes, content.byteLength - 262144);
  assert.equal(result.sha256, createHash("sha256").update(content).digest("hex"));
  assert.equal(result.file.id, "resumed-file");
  assert.ok(events.some((event) => event.type === "progress" && event.phase === "upload" && event.bytes === content.byteLength));
});

test("untrusted resumable session URLs are rejected before any upload request", async () => {
  let called = false;
  await assert.rejects(
    uploadResumableStream({
      sessionUrl: "https://attacker.example/upload/drive/v3/files?upload_id=bad",
      source: streamFrom([new Uint8Array([1])]),
      expectedSize: 1,
      mime: "application/octet-stream",
      signal: new AbortController().signal,
      emit: () => {},
      fetcher: async () => {
        called = true;
        return finalResponse();
      },
    }),
    /untrusted resumable upload url/i,
  );
  assert.equal(called, false);
});
