import assert from "node:assert/strict";
import test from "node:test";
import { getAllProviders, getProvider, registerProvider } from "../src/lib/providers/registry";

test("the public provider catalog matches registered built-in adapters", () => {
  const providers = getAllProviders();
  assert.deepEqual(providers.map((provider) => provider.id), ["github", "drive", "onedrive", "dropbox"]);
  assert.deepEqual(providers.map((provider) => provider.uploadMode), ["buffered", "chunked-stream", "chunked-stream", "chunked-stream"]);
  assert.equal(getProvider("github")?.displayName, "GitHub");
  assert.equal(getProvider("drive")?.displayName, "Google Drive");
  assert.equal(getProvider("onedrive")?.displayName, "OneDrive");
  assert.equal(getProvider("dropbox")?.displayName, "Dropbox");
  assert.equal(getProvider("not-a-provider"), null);
});

test("the registry rejects duplicate provider IDs", () => {
  const github = getProvider("github");
  assert.ok(github);
  assert.throws(() => registerProvider(github), /already registered/i);
});


test("the registry rejects malformed providers before they can serve transfers", () => {
  assert.throws(
    () => registerProvider({
      id: "broken-provider",
      displayName: "Broken",
      icon: "cloud",
      maxFileBytes: null,
      uploadMode: "chunked-stream",
      resolveCredentials: undefined,
      uploadFile: undefined,
    } as never),
    /missing required members|invalid metadata/i,
  );
});
