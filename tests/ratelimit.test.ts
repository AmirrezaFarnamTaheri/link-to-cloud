import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter } from "../src/lib/ratelimit";

test("bounded rate limiter enforces fixed windows and replaces old buckets at capacity", () => {
  const allow = createRateLimiter(2);
  assert.equal(allow("a", 2, 60_000), true);
  assert.equal(allow("b", 1, 60_000), true);
  assert.equal(allow("b", 1, 60_000), false);
  assert.equal(allow("a", 2, 60_000), true);
  assert.equal(allow("c", 1, 60_000), true);
  assert.equal(allow("a", 2, 60_000), false);

  // The configured capacity is respected: after a new key is inserted, an older bucket is replaced.
  assert.equal(allow("b", 1, 60_000), true);
  assert.equal(allow("b", 1, 60_000), false);
});

test("invalid rate-limit settings fail closed", () => {
  const allow = createRateLimiter();
  assert.equal(allow("bad", 0, 60_000), false);
  assert.equal(allow("bad", 1, 0), false);
});
