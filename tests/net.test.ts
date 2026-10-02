import assert from "node:assert/strict";
import test from "node:test";
import { assertPublic, safeFetch } from "../src/lib/net";

test("SSRF checks reject IPv4-mapped loopback and non-global IPv6 addresses", async () => {
  await assert.rejects(assertPublic(new URL("http://[::ffff:7f00:1]/")), /private\/internal/i);
  await assert.rejects(assertPublic(new URL("http://[fe90::1]/")), /private\/internal/i);
  await assert.rejects(assertPublic(new URL("http://[2001:db8::1]/")), /private\/internal/i);
  await assert.doesNotReject(assertPublic(new URL("https://[2001:4860:4860::8888]/")));
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
