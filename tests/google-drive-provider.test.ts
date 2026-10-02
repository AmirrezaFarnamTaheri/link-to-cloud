import assert from "node:assert/strict";
import test from "node:test";
import { googleDriveProvider } from "../src/lib/providers/google-drive";
import type { TransferEvent } from "../src/lib/types";

test("new Drive folder identity is emitted as soon as creation succeeds", async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const events: TransferEvent[] = [];
  let requests = 0;
  globalThis.fetch = (async (input, init) => {
    requests++;
    if (String(input).includes("/drive/v3/files?fields=id,name")) {
      return new Response(JSON.stringify({ id: "folder-1", name: "uploads" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    assert.equal(init?.signal?.aborted, true);
    throw new Error("aborted after folder creation");
  }) as typeof fetch;

  try {
    await assert.rejects(
      googleDriveProvider.uploadFile(
        {
          request: { target: "drive", url: "https://files.example/file.bin", newFolder: "uploads" },
          source: new Response("payload"),
          name: "file.bin",
          size: 7,
          emit: (event) => {
            events.push(event);
            if (event.type === "destination-created") controller.abort();
          },
          signal: controller.signal,
        },
        { accessToken: "test-token", owner: "google:sub:1" },
      ),
      /aborted after folder creation/i,
    );
    assert.deepEqual(events.filter((event) => event.type === "destination-created"), [
      { type: "destination-created", target: "drive", folderId: "folder-1" },
    ]);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
