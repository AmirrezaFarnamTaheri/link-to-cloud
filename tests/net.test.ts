import assert from "node:assert/strict";
import test from "node:test";
import { assertPublic, safeFetch } from "../src/lib/net";

test("SSRF checks reject private, reserved, and non-global IPv4/IPv6 ranges", async () => {
  const rejected = [
    "http://[::ffff:7f00:1]/",
    "http://[fe90::1]/",
    "http://[2001:db8::1]/",
    "http://[2001:1::1]/",
    "http://[2001:2::1]/",
    "http://[2001:10::1]/",
    "http://[2001:20::1]/",
    "http://[3fff::1]/",
    "http://[5f00::1]/",
    "http://192.0.2.1/",
    "http://198.18.0.1/",
    "http://198.51.100.1/",
    "http://203.0.113.1/",
  ];
  for (const address of rejected) {
    await assert.rejects(assertPublic(new URL(address)), /private, non-public, or special-use/i, address);
  }
  await assert.doesNotReject(assertPublic(new URL("https://8.8.8.8/")));
  await assert.doesNotReject(assertPublic(new URL("https://[2001:4860:4860::8888]/")));
});

test("source body idle timeout aborts the pinned upstream request", async () => {
  let fetchSignal: AbortSignal | undefined;
  const { res } = await safeFetch("https://8.8.8.8/stalled.bin", {
    bodyIdleTimeoutMs: 10,
    fetcher: async (_input, init) => {
      fetchSignal = init?.signal as AbortSignal;
      return new Response(new ReadableStream<Uint8Array>({ pull() {} }, { highWaterMark: 0 }));
    },
  });
  const reader = res.body!.getReader();
  await assert.rejects(reader.read(), /source stopped sending data/i);
  assert.equal(fetchSignal?.aborted, true);
  reader.releaseLock();
});

test("source bodies are not prefetched before the destination chooses to consume them", async () => {
  let sourceReads = 0;
  let sourceCancelled = false;
  const sourceBody = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        sourceReads++;
        controller.enqueue(new TextEncoder().encode("source bytes"));
      },
      cancel() {
        sourceCancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const { res } = await safeFetch("https://8.8.8.8/file.bin", {
    fetcher: async () => new Response(sourceBody),
  });

  assert.equal(sourceReads, 0);
  await res.body?.cancel();
  assert.equal(sourceReads, 0);
  assert.equal(sourceCancelled, true);
});

test("source fetch pins its dispatcher and stays linked to transfer cancellation while streaming", async () => {
  const controller = new AbortController();
  let fetchSignal: AbortSignal | undefined;
  let dispatcher: unknown;

  const { res } = await safeFetch("https://8.8.8.8/file.bin", {
    signal: controller.signal,
    fetcher: async (_input, init) => {
      fetchSignal = init?.signal as AbortSignal;
      dispatcher = (init as RequestInit & { dispatcher?: unknown }).dispatcher;
      return new Response("file contents");
    },
  });

  assert.ok(fetchSignal);
  assert.ok(dispatcher);
  assert.equal(fetchSignal.aborted, false);
  controller.abort();
  assert.equal(fetchSignal.aborted, true);
  await res.body?.cancel();
});
