import assert from "node:assert/strict";
import test from "node:test";
import { githubProvider } from "../src/lib/providers/github";
import type { TransferEvent } from "../src/lib/types";

test("GitHub skip-existing cancels the source before reading the file and omits an uncomputed checksum", async () => {
  let sourceCancelled = false;
  let sourcePulls = 0;
  const source = new Response(
    new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          sourcePulls++;
          controller.enqueue(new TextEncoder().encode("payload"));
        },
        cancel() {
          sourceCancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
    { headers: { "Content-Length": "7", "Content-Type": "application/octet-stream" } },
  );
  const originalFetch = globalThis.fetch;
  const requests: Array<RequestInfo | URL> = [];
  globalThis.fetch = (async (input) => {
    requests.push(input);
    return new Response(JSON.stringify({ sha: "blob-sha", html_url: "https://github.com/owner/repo/blob/main/file.bin" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await githubProvider.uploadFile(
      {
        request: { target: "github", url: "https://files.example/file.bin", repo: "owner/repo", ifExists: "skip" },
        source,
        name: "file.bin",
        size: 7,
        emit: () => {},
        signal: new AbortController().signal,
      },
      { accessToken: "test-token", owner: "github:id:1" },
    );

    assert.equal(result.skipped, true);
    assert.equal(result.bytes, 7);
    assert.equal(result.sha256, null);
    assert.equal(result.url, "https://github.com/owner/repo/blob/main/file.bin");
    assert.equal(requests.length, 1);
    assert.equal(sourcePulls, 0);
    assert.equal(sourceCancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("new repository identity is emitted as soon as creation succeeds", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const events: TransferEvent[] = [];
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new Response(JSON.stringify({ full_name: "owner/new-repo" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      githubProvider.uploadFile(
        {
          request: {
            target: "github",
            url: "https://files.example/file.bin",
            newRepo: { name: "new-repo", private: true },
          },
          source: new Response("payload"),
          name: "file.bin",
          size: 7,
          emit: (event) => {
            events.push(event);
            if (event.type === "destination-created") controller.abort();
          },
          signal: controller.signal,
        },
        { accessToken: "test-token", owner: "github:id:1" },
      ),
      /cancelled/i,
    );
    assert.deepEqual(events.filter((event) => event.type === "destination-created"), [
      { type: "destination-created", target: "github", repo: "owner/new-repo" },
    ]);
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
