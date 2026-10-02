import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { dropboxProvider } from "../src/lib/providers/dropbox";
import { oneDriveProvider } from "../src/lib/providers/onedrive";

const bytes = new TextEncoder().encode("streamed payload");
const digest = createHash("sha256").update(bytes).digest("hex");

test("Dropbox streams a bounded upload session and commits with autorename", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; arg: unknown; body: Uint8Array }> = [];
  globalThis.fetch = (async (input, init) => {
    const headers = new Headers(init?.headers);
    const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
    calls.push({ url: String(input), arg: JSON.parse(headers.get("Dropbox-API-Arg") ?? "{}"), body });
    if (String(input).endsWith("/upload_session/start")) {
      return new Response(JSON.stringify({ session_id: "session-1" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input).endsWith("/upload_session/append_v2")) return new Response(null, { status: 200 });
    if (String(input).endsWith("/upload_session/finish")) {
      return new Response(JSON.stringify({ name: "payload (1).bin", path_display: "/uploads/payload (1).bin" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request ${input}`);
  }) as typeof fetch;

  try {
    const result = await dropboxProvider.uploadFile(
      {
        request: { target: "dropbox", url: "https://files.example/payload.bin", path: "uploads" },
        source: new Response(bytes),
        name: "payload.bin",
        size: bytes.byteLength,
        emit: () => {},
        signal: new AbortController().signal,
      },
      { accessToken: "test-token", owner: "dropbox:id:test" },
    );
    assert.equal(result.name, "payload (1).bin");
    assert.equal(result.bytes, bytes.byteLength);
    assert.equal(result.sha256, digest);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[1].arg, { cursor: { session_id: "session-1", offset: 0 }, close: false });
    assert.deepEqual(calls[1].body, bytes);
    assert.equal((calls[2].arg as { commit: { autorename: boolean } }).commit.autorename, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OneDrive requires a known length and uploads the matching byte range to a trusted session host", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers: Headers; body: Uint8Array }> = [];
  globalThis.fetch = (async (input, init) => {
    const headers = new Headers(init?.headers);
    const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
    calls.push({ url: String(input), headers, body });
    if (String(input).includes("createUploadSession")) {
      return new Response(JSON.stringify({ uploadUrl: "https://tenant.up.1drv.com/up/session" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input) === "https://tenant.up.1drv.com/up/session") {
      return new Response(JSON.stringify({ name: "payload.bin", webUrl: "https://onedrive.live.com/item" }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request ${input}`);
  }) as typeof fetch;

  try {
    const result = await oneDriveProvider.uploadFile(
      {
        request: { target: "onedrive", url: "https://files.example/payload.bin", path: "uploads" },
        source: new Response(bytes),
        name: "payload.bin",
        size: bytes.byteLength,
        emit: () => {},
        signal: new AbortController().signal,
      },
      { accessToken: "test-token", owner: "onedrive:id:test" },
    );
    assert.equal(result.bytes, bytes.byteLength);
    assert.equal(result.sha256, digest);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].headers.get("content-range"), `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`);
    assert.deepEqual(calls[1].body, bytes);

    await assert.rejects(
      oneDriveProvider.uploadFile(
        {
          request: { target: "onedrive", url: "https://files.example/unknown.bin" },
          source: new Response(bytes),
          name: "unknown.bin",
          size: null,
          emit: () => {},
          signal: new AbortController().signal,
        },
        { accessToken: "test-token", owner: "onedrive:id:test" },
      ),
      /Content-Length/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
