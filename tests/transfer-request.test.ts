import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../src/lib/net";
import { registerProvider } from "../src/lib/providers/registry";
import { MAX_TRANSFER_REQUEST_BYTES, readTransferRequest, validateTransferRequest } from "../src/lib/transfer-request";

const base = { url: "https://downloads.example/file.zip" };

test("valid GitHub and Drive request shapes are parsed as discriminated targets", () => {
  const github = validateTransferRequest({
    ...base,
    target: "github",
    repo: "owner/repository",
    path: "assets/downloads",
    ifExists: "rename",
  });
  const drive = validateTransferRequest({ ...base, target: "drive", folderId: "folder_123-" });

  assert.equal(github.target, "github");
  if (github.target === "github") assert.equal(github.repo, "owner/repository");
  assert.equal(drive.target, "drive");
  if (drive.target === "drive") assert.equal(drive.folderId, "folder_123-");
});

test("OneDrive and Dropbox accept only relative destination paths", () => {
  const oneDrive = validateTransferRequest({ ...base, target: "onedrive", path: "exports/2026" });
  const dropbox = validateTransferRequest({ ...base, target: "dropbox", path: "exports/2026" });
  assert.deepEqual(oneDrive, { ...base, target: "onedrive", path: "exports/2026" });
  assert.deepEqual(dropbox, { ...base, target: "dropbox", path: "exports/2026" });
  assert.throws(() => validateTransferRequest({ ...base, target: "onedrive", path: "safe/../private" }), /destination folder path/i);
  assert.throws(() => validateTransferRequest({ ...base, target: "dropbox", path: ".." }), /destination folder path/i);
});

test("operator plugins use a namespaced target and a provider-owned destination schema", () => {
  registerProvider({
    id: "test-plugin",
    displayName: "Test Plugin",
    icon: "cloud",
    maxFileBytes: null,
    uploadMode: "chunked-stream",
    destinationFields: [{ key: "bucket", label: "Bucket", required: true }],
    validateDestination(value) {
      if (typeof value.bucket !== "string" || !/^[a-z0-9-]{3,63}$/.test(value.bucket)) throw new HttpError("invalid bucket");
      return { bucket: value.bucket };
    },
    async resolveCredentials() { return null; },
    async uploadFile() { throw new Error("not reached"); },
  });
  assert.deepEqual(
    validateTransferRequest({ ...base, target: "plugin:test-plugin", destination: { bucket: "public-files" } }),
    { ...base, target: "plugin:test-plugin", destination: { bucket: "public-files" } },
  );
  assert.throws(() => validateTransferRequest({ ...base, target: "plugin:test-plugin", destination: { bucket: "../bad" } }), /invalid bucket/i);
  assert.throws(() => validateTransferRequest({ ...base, target: "test-plugin", destination: { bucket: "public-files" } }), /supported destination/i);
});

test("request schemas reject unknown fields and provider-field mixups", () => {
  assert.throws(() => validateTransferRequest({ ...base, target: "drive", providerId: "google-drive" }), /unexpected request field/i);
  assert.throws(() => validateTransferRequest({ ...base, target: "github", folderId: "folder_123" }), /unexpected request field/i);
});

test("path traversal and mutually exclusive destination choices are rejected", () => {
  assert.throws(() => validateTransferRequest({ ...base, target: "github", repo: "owner/repo", path: "safe/../private" }), /invalid repository folder path/i);
  assert.throws(() => validateTransferRequest({ ...base, target: "github", repo: "owner/repo", newRepo: { name: "another", private: true } }), /not both/i);
  assert.throws(() => validateTransferRequest({ ...base, target: "drive", folderId: "folder_123", newFolder: "New folder" }), /not both/i);
});

test("URLs with unsupported protocols or embedded credentials are rejected", () => {
  assert.throws(() => validateTransferRequest({ url: "file:///etc/passwd", target: "drive" }), /http\(s\)/i);
  assert.throws(() => validateTransferRequest({ url: "https://user:secret@downloads.example/file", target: "drive" }), /credentials/i);
});

test("streamed JSON bodies are capped even when Content-Length is absent", async () => {
  const body = new Uint8Array(MAX_TRANSFER_REQUEST_BYTES + 1).fill(0x20);
  const request = new Request("https://relay.example/api/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  await assert.rejects(readTransferRequest(request), /too large/i);
});

test("malformed JSON and non-JSON media types produce deterministic client errors", async () => {
  const malformed = new Request("https://relay.example/api/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid",
  });
  await assert.rejects(readTransferRequest(malformed), /valid json/i);

  const plainText = new Request("https://relay.example/api/transfer", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ url: "https://files.example/file.zip", target: "drive" }),
  });
  await assert.rejects(readTransferRequest(plainText), /application\/json/i);
});
