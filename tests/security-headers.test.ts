import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config";

test("production config emits a same-origin CSP while development stays compatible with HMR", async () => {
  assert.equal(nextConfig.poweredByHeader, false);
  const originalNodeEnv = process.env.NODE_ENV;

  try {
    Reflect.set(process.env, "NODE_ENV", "production");
    const productionRules = await nextConfig.headers?.();
    const productionHeaders = productionRules?.find((rule) => rule.source === "/:path*")?.headers;
    assert.ok(productionHeaders);
    const values = new Map(productionHeaders.map(({ key, value }) => [key.toLowerCase(), value]));

    assert.equal(values.get("x-content-type-options"), "nosniff");
    assert.equal(values.get("x-frame-options"), "DENY");
    assert.equal(values.get("referrer-policy"), "no-referrer");
    assert.equal(values.get("permissions-policy"), "camera=(), microphone=(), geolocation=()");
    assert.match(values.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(values.get("content-security-policy") ?? "", /connect-src 'self'/);
    assert.match(values.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
    assert.doesNotMatch(values.get("content-security-policy") ?? "", /unsafe-eval/);

    Reflect.set(process.env, "NODE_ENV", "development");
    const developmentRules = await nextConfig.headers?.();
    const developmentHeaders = developmentRules?.find((rule) => rule.source === "/:path*")?.headers;
    assert.ok(developmentHeaders);
    assert.ok(developmentHeaders.some((header) => header.key === "X-Content-Type-Options"));
    assert.ok(!developmentHeaders.some((header) => header.key === "Content-Security-Policy"));
  } finally {
    if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
  }
});
