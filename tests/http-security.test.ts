import assert from "node:assert/strict";
import test from "node:test";
import { readJsonObjectRequest } from "../src/lib/http";
import { HttpError } from "../src/lib/net";
import { clientIp, isSameOriginRequest, originOf } from "../src/lib/session";

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("small JSON request reader enforces content type and streamed size limits", async () => {
  const valid = new Request("https://relay.example/api", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ token: "secret" }),
  });
  assert.deepEqual(await readJsonObjectRequest(valid, 128), { token: "secret" });

  const plainText = new Request("https://relay.example/api", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ token: "secret" }),
  });
  await assert.rejects(readJsonObjectRequest(plainText, 128), (error: unknown) => error instanceof HttpError && error.status === 415);

  const oversized = new Request("https://relay.example/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "x".repeat(2048) }),
  });
  await assert.rejects(readJsonObjectRequest(oversized, 64), (error: unknown) => error instanceof HttpError && error.status === 413);
});

test("small JSON request reader times out a stalled control-body stream", async () => {
  const stalled = {
    headers: new Headers({ "Content-Type": "application/json" }),
    body: new ReadableStream<Uint8Array>({ pull() {} }, { highWaterMark: 0 }),
  } as unknown as Request;
  await assert.rejects(
    readJsonObjectRequest(stalled, 128, "Test", 10),
    (error: unknown) => error instanceof HttpError && error.status === 408,
  );
});

test("configured app origin overrides spoofable forwarded host headers for CSRF checks", () => {
  const oldOrigin = process.env.APP_ORIGIN;
  const oldNodeEnv = process.env.NODE_ENV;
  try {
    setEnv("NODE_ENV", "test");
    process.env.APP_ORIGIN = "https://relay.example";
    const same = new Request("https://internal.service/api", {
      headers: { Origin: "https://relay.example", "X-Forwarded-Host": "attacker.example", "X-Forwarded-Proto": "http" },
    });
    const cross = new Request("https://internal.service/api", {
      headers: { Origin: "https://attacker.example", "X-Forwarded-Host": "attacker.example" },
    });
    assert.equal(originOf(same), "https://relay.example");
    assert.equal(isSameOriginRequest(same), true);
    assert.equal(isSameOriginRequest(cross), false);
    assert.equal(isSameOriginRequest(new Request("https://relay.example/api")), true);
  } finally {
    setEnv("APP_ORIGIN", oldOrigin);
    setEnv("NODE_ENV", oldNodeEnv);
  }
});

test("production requires a canonical APP_ORIGIN instead of forwarded-host discovery", () => {
  const oldOrigin = process.env.APP_ORIGIN;
  const oldNodeEnv = process.env.NODE_ENV;
  const oldGithubId = process.env.GITHUB_CLIENT_ID;
  try {
    delete process.env.APP_ORIGIN;
    setEnv("NODE_ENV", "production");
    setEnv("GITHUB_CLIENT_ID", undefined);
    const request = new Request("https://relay.example/api/auth", { headers: { "X-Forwarded-Host": "attacker.example" } });
    assert.throws(() => originOf(request), /APP_ORIGIN is required/i);
    assert.equal(isSameOriginRequest(new Request("https://relay.example/api", { headers: { Origin: "https://relay.example" } })), false);
    process.env.APP_ORIGIN = "https://relay.example";
    assert.equal(isSameOriginRequest(new Request("https://internal.service/api", { headers: { Origin: "https://relay.example" } })), true);
  } finally {
    setEnv("APP_ORIGIN", oldOrigin);
    setEnv("NODE_ENV", oldNodeEnv);
    setEnv("GITHUB_CLIENT_ID", oldGithubId);
  }
});

test("client IP selection uses the rightmost valid forwarded address by default", () => {
  const oldHeader = process.env.CLIENT_IP_HEADER;
  try {
    delete process.env.CLIENT_IP_HEADER;
    const forwarded = new Request("https://relay.example/api", {
      headers: { "X-Forwarded-For": "198.51.100.50, 203.0.113.25", "X-Real-IP": "192.0.2.1" },
    });
    assert.equal(clientIp(forwarded), "203.0.113.25");
    assert.equal(clientIp(new Request("https://relay.example/api", { headers: { "X-Real-IP": "8.8.8.8" } })), "unknown");
  } finally {
    setEnv("CLIENT_IP_HEADER", oldHeader);
  }
});

test("a configured canonical client-IP header takes precedence and fails closed", () => {
  const oldHeader = process.env.CLIENT_IP_HEADER;
  try {
    process.env.CLIENT_IP_HEADER = "X-Trusted-Client-IP";
    const trusted = new Request("https://relay.example/api", {
      headers: { "X-Trusted-Client-IP": "203.0.113.50", "X-Forwarded-For": "198.51.100.1, 198.51.100.2" },
    });
    assert.equal(clientIp(trusted), "203.0.113.50");
    const malformed = new Request("https://relay.example/api", {
      headers: { "X-Trusted-Client-IP": "203.0.113.50, 203.0.113.51", "X-Forwarded-For": "198.51.100.1" },
    });
    assert.equal(clientIp(malformed), "unknown");
    assert.equal(clientIp(new Request("https://relay.example/api")), "unknown");
  } finally {
    setEnv("CLIENT_IP_HEADER", oldHeader);
  }
});
