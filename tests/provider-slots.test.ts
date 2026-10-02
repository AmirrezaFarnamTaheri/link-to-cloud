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

for (const target of ["drive", "onedrive", "dropbox"]) {
  test(`${target} capacity permits two bounded streams and rejects excess work`, () => {
    const first = acquireTransferSlot(target);
    const second = acquireTransferSlot(target);
    assert.equal(typeof first, "function");
    assert.equal(typeof second, "function");
    assert.equal(acquireTransferSlot(target), null);
    first?.();
    assert.equal(typeof acquireTransferSlot(target), "function");
    const remaining = acquireTransferSlot(target);
    second?.();
    remaining?.();
  });
}
