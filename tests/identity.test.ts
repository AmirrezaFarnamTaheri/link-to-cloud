import assert from "node:assert/strict";
import test from "node:test";
import { parseDropboxProfile, parseGitHubProfile, parseGoogleProfile, parseOneDriveProfile, refreshTokenForIdentity, refreshTokenForStableId } from "../src/lib/identity";
import { revokeGoogle } from "../src/lib/google";
import { dropboxOwner, githubOwner, googleOwner, oneDriveOwner, sessionOwnerKeys } from "../src/lib/owners";

test("provider profiles require stable identifiers and usable display identities", () => {
  assert.deepEqual(parseGitHubProfile({ id: 123, login: "octocat" }), { id: 123, login: "octocat" });
  assert.equal(parseGitHubProfile({ id: "123", login: "octocat" }), null);
  assert.equal(parseGitHubProfile({ id: 123, login: "not a login" }), null);

  assert.deepEqual(parseGoogleProfile({ sub: "subject-1", email: "user@example.com" }), {
    sub: "subject-1",
    email: "user@example.com",
  });
  assert.equal(parseGoogleProfile({ sub: "subject-1", email: "Google account" }), null);

  assert.deepEqual(parseOneDriveProfile({ id: "microsoft-id", displayName: "OneDrive User" }), { id: "microsoft-id", name: "OneDrive User" });
  assert.equal(parseOneDriveProfile({ id: "", displayName: "OneDrive User" }), null);
  assert.deepEqual(parseDropboxProfile({ account_id: "dbid:123", name: { display_name: "Dropbox User" } }), { accountId: "dbid:123", name: "Dropbox User" });
  assert.equal(parseDropboxProfile({ account_id: "dbid:123", name: {} }), null);
});

test("Google refresh tokens are carried forward only for the same account", () => {
  const next = { sub: "subject-b", email: "b@example.com" };
  assert.equal(
    refreshTokenForIdentity(undefined, { sub: "subject-a", email: "a@example.com", refresh: "refresh-a" }, next),
    undefined,
  );
  assert.equal(
    refreshTokenForIdentity(undefined, { sub: "subject-b", email: "old@example.com", refresh: "refresh-b" }, next),
    "refresh-b",
  );
  assert.equal(
    refreshTokenForIdentity(undefined, { email: "b@example.com", refresh: "legacy-refresh" }, next),
    undefined,
    "mutable email alone cannot bind a legacy refresh token to a stable subject",
  );
  assert.equal(
    refreshTokenForIdentity("new-refresh", { sub: "subject-a", email: "a@example.com", refresh: "old" }, next),
    "new-refresh",
  );
  assert.equal(refreshTokenForStableId(undefined, { id: "one", refresh: "old-refresh" }, "two"), undefined);
  assert.equal(refreshTokenForStableId(undefined, { id: "one", refresh: "old-refresh" }, "one"), "old-refresh");
});

test("Google token revocation keeps the token out of the request URL", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestMethod = "";
  let contentType = "";
  let requestBody = "";
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestMethod = init?.method ?? "";
    contentType = new Headers(init?.headers).get("content-type") ?? "";
    requestBody = String(init?.body);
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    await revokeGoogle("secret-token+with/symbols");
    assert.equal(requestUrl, "https://oauth2.googleapis.com/revoke");
    assert.equal(requestMethod, "POST");
    assert.equal(contentType, "application/x-www-form-urlencoded");
    assert.equal(requestBody, "token=secret-token%2Bwith%2Fsymbols");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("history ownership uses immutable IDs and limits legacy keys to legacy sessions", () => {
  const session = {
    github: { id: 123, login: "octocat", token: "secret", via: "oauth" as const },
    google: { sub: "subject-1", email: "user@example.com", token: "secret", expiresAt: 0 },
  };
  assert.equal(githubOwner(session.github), "github:id:123");
  assert.equal(googleOwner(session.google), "google:sub:subject-1");
  assert.equal(oneDriveOwner({ id: "microsoft-id" }), "onedrive:id:microsoft-id");
  assert.equal(dropboxOwner({ accountId: "dbid:123" }), "dropbox:id:dbid:123");
  assert.deepEqual(sessionOwnerKeys(session), ["github:id:123", "google:sub:subject-1"]);
  assert.deepEqual(
    sessionOwnerKeys({
      github: { login: "octocat", token: "secret", via: "token" },
      google: { email: "user@example.com", token: "secret", expiresAt: 0 },
    }),
    ["github:octocat", "google:user@example.com"],
  );
  assert.deepEqual(sessionOwnerKeys({ github: { login: "unknown", token: "secret", via: "oauth" } }), []);
});
