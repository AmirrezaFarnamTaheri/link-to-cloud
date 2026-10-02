import assert from "node:assert/strict";
import test from "node:test";
import { acquireTransferSlot } from "../src/lib/providers/slots";

test("GitHub provider capacity is one transfer per process and release is idempotent", () => {
  const release = acquireTransferSlot("github");
  assert.equal(typeof release, "function");
  assert.equal(acquireTransferSlot("github"), null);
  release!();
  release!();
  const cleanup = acquireTransferSlot("github");
  assert.equal(typeof cleanup, "function");
  cleanup?.();
});

test("Drive provider capacity permits two bounded streams and rejects excess work", () => {
  const first = acquireTransferSlot("drive");
  const second = acquireTransferSlot("drive");
  assert.equal(typeof first, "function");
  assert.equal(typeof second, "function");
  assert.equal(acquireTransferSlot("drive"), null);
  first?.();
  assert.equal(typeof acquireTransferSlot("drive"), "function");
  const remaining = acquireTransferSlot("drive");
  second?.();
  remaining?.();
});
