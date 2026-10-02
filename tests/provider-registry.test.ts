import assert from "node:assert/strict";
import test from "node:test";
import { getAllProviders, getProvider, registerProvider } from "../src/lib/providers/registry";

test("the public provider catalog matches registered adapters", () => {
  const providers = getAllProviders();
  assert.deepEqual(providers.map((provider) => provider.id), ["github", "drive"]);
  assert.deepEqual(providers.map((provider) => provider.uploadMode), ["buffered", "chunked-stream"]);
  assert.equal(getProvider("github")?.displayName, "GitHub");
  assert.equal(getProvider("drive")?.displayName, "Google Drive");
  assert.equal(getProvider("onedrive"), null);
});

test("the registry rejects duplicate provider IDs", () => {
  const github = getProvider("github");
  assert.ok(github);
  assert.throws(() => registerProvider(github), /already registered/i);
});
