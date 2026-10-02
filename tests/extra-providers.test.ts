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
        request: { target: "dropbox", url: "https://files.example/payload.bin", path: "uploads", ifExists: "rename" },
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
        request: { target: "onedrive", url: "https://files.example/payload.bin", path: "uploads", ifExists: "rename" },
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


test("Dropbox overwrite and skip map to the selected conflict behavior", async () => {
  const originalFetch = globalThis.fetch;
  const overwriteCalls: Array<{ url: string; arg: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    const headers = new Headers(init?.headers);
    const arg = headers.get("Dropbox-API-Arg");
    overwriteCalls.push({ url: String(input), arg: arg ? JSON.parse(arg) : JSON.parse(String(init?.body ?? "{}")) });
    if (String(input).endsWith("/upload_session/start")) {
      return new Response(JSON.stringify({ session_id: "session-overwrite" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(input).endsWith("/upload_session/append_v2")) return new Response(null, { status: 200 });
    if (String(input).endsWith("/upload_session/finish")) {
      return new Response(JSON.stringify({ name: "payload.bin", path_display: "/uploads/payload.bin" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request ${input}`);
  }) as typeof fetch;

  try {
    await dropboxProvider.uploadFile(
      {
        request: { target: "dropbox", url: "https://files.example/payload.bin", path: "uploads", ifExists: "overwrite" },
        source: new Response(bytes),
        name: "payload.bin",
        size: bytes.byteLength,
        emit: () => {},
        signal: new AbortController().signal,
      },
      { accessToken: "test-token", owner: "dropbox:id:test" },
    );
    const finish = overwriteCalls.find((call) => call.url.endsWith("/upload_session/finish"));
    assert.deepEqual((finish?.arg as { commit?: unknown }).commit, {
      path: "/uploads/payload.bin",
      mode: "overwrite",
      autorename: false,
      mute: false,
      strict_conflict: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  let sourceCancelled = false;
  globalThis.fetch = (async (input) => {
    assert.equal(String(input), "https://api.dropboxapi.com/2/files/get_metadata");
    return new Response(JSON.stringify({ name: "payload.bin", path_display: "/uploads/payload.bin" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const source = new Response(new ReadableStream<Uint8Array>({ cancel() { sourceCancelled = true; } }));
  try {
    const skipped = await dropboxProvider.uploadFile(
      {
        request: { target: "dropbox", url: "https://files.example/payload.bin", path: "uploads", ifExists: "skip" },
        source,
        name: "payload.bin",
        size: 123,
        emit: () => {},
        signal: new AbortController().signal,
      },
      { accessToken: "test-token", owner: "dropbox:id:test" },
    );
    assert.equal(skipped.skipped, true);
    assert.equal(sourceCancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OneDrive maps rename/overwrite and skips an existing destination before upload", async () => {
  const originalFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url.includes("createUploadSession")) {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ uploadUrl: "https://tenant.up.1drv.com/up/session" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url === "https://tenant.up.1drv.com/up/session") {
      return new Response(JSON.stringify({ name: "payload.bin", webUrl: "https://onedrive.live.com/item" }), { status: 201, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected request ${input}`);
  }) as typeof fetch;
  try {
    await oneDriveProvider.uploadFile(
      {
        request: { target: "onedrive", url: "https://files.example/payload.bin", path: "uploads", ifExists: "overwrite" },
        source: new Response(bytes),
        name: "payload.bin",
        size: bytes.byteLength,
        emit: () => {},
        signal: new AbortController().signal,
      },
      { accessToken: "test-token", owner: "onedrive:id:test" },
    );
    assert.deepEqual(bodies[0], { item: { "@microsoft.graph.conflictBehavior": "replace" } });
  } finally {
    globalThis.fetch = originalFetch;
  }

  let cancelled = false;
  globalThis.fetch = (async (input) => {
    assert.equal(String(input), "https://graph.microsoft.com/v1.0/me/drive/root:/uploads/payload.bin");
    return new Response(JSON.stringify({ name: "payload.bin", webUrl: "https://onedrive.live.com/existing" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  const source = new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } }));
  try {
    const skipped = await oneDriveProvider.uploadFile(
      {
        request: { target: "onedrive", url: "https://files.example/payload.bin", path: "uploads", ifExists: "skip" },
        source,
        name: "payload.bin",
        size: 123,
        emit: () => {},
        signal: new AbortController().signal,
      },
      { accessToken: "test-token", owner: "onedrive:id:test" },
    );
    assert.equal(skipped.skipped, true);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Dropbox skip treats only path/not_found as a missing destination", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    assert.equal(String(input), "https://api.dropboxapi.com/2/files/get_metadata");
    return new Response(JSON.stringify({
      error_summary: "path/restricted_content/",
      error: { ".tag": "path", path: { ".tag": "restricted_content" } },
    }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await assert.rejects(
      dropboxProvider.uploadFile(
        {
          request: { target: "dropbox", url: "https://files.example/payload.bin", path: "uploads", ifExists: "skip" },
          source: new Response(bytes),
          name: "payload.bin",
          size: bytes.byteLength,
          emit: () => {},
          signal: new AbortController().signal,
        },
        { accessToken: "test-token", owner: "dropbox:id:test" },
      ),
      /restricted_content/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("skip uses fail-on-conflict semantics after the destination pre-check", async () => {
  const originalFetch = globalThis.fetch;

  const oneDriveBodies: unknown[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    if (url === "https://graph.microsoft.com/v1.0/me/drive/root:/uploads/payload.bin") {
      return new Response(JSON.stringify({ error: { message: "not found" } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("createUploadSession")) {
      oneDriveBodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ uploadUrl: "https://tenant.up.1drv.com/up/session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "https://tenant.up.1drv.com/up/session") {
      return new Response(JSON.stringify({ name: "payload.bin", webUrl: "https://onedrive.live.com/item" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected request ${input}`);
  }) as typeof fetch;

  try {
    await oneDriveProvider.uploadFile(
      {
        request: { target: "onedrive", url: "https://files.example/payload.bin", path: "uploads", ifExists: "skip" },
        source: new Response(bytes),
        name: "payload.bin",
        size: bytes.byteLength,
        emit: () => {},
        signal: new AbortController().signal,
      },
      { accessToken: "test-token", owner: "onedrive:id:test" },
    );
    assert.deepEqual(oneDriveBodies[0], { item: { "@microsoft.graph.conflictBehavior": "fail" } });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const dropboxCalls: Array<{ url: string; arg: unknown }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const argHeader = headers.get("Dropbox-API-Arg");
    dropboxCalls.push({
      url,
      arg: argHeader ? JSON.parse(argHeader) : JSON.parse(String(init?.body ?? "{}")),
    });
    if (url === "https://api.dropboxapi.com/2/files/get_metadata") {
      return new Response(JSON.stringify({
        error_summary: "path/not_found/",
        error: { ".tag": "path", path: { ".tag": "not_found" } },
      }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/upload_session/start")) {
      return new Response(JSON.stringify({ session_id: "session-skip" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.endsWith("/upload_session/append_v2")) return new Response(null, { status: 200 });
    if (url.endsWith("/upload_session/finish")) {
      return new Response(JSON.stringify({ name: "payload.bin", path_display: "/uploads/payload.bin" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error(`Unexpected request ${input}`);
  }) as typeof fetch;

  try {
    await dropboxProvider.uploadFile(
      {
        request: { target: "dropbox", url: "https://files.example/payload.bin", path: "uploads", ifExists: "skip" },
        source: new Response(bytes),
        name: "payload.bin",
        size: bytes.byteLength,
        emit: () => {},
        signal: new AbortController().signal,
      },
      { accessToken: "test-token", owner: "dropbox:id:test" },
    );
    const finish = dropboxCalls.find((call) => call.url.endsWith("/upload_session/finish"));
    assert.deepEqual((finish?.arg as { commit?: unknown }).commit, {
      path: "/uploads/payload.bin",
      mode: "add",
      autorename: false,
      mute: false,
      strict_conflict: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
