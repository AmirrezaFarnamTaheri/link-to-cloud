import assert from "node:assert/strict";
import test from "node:test";
import { readAll } from "../src/lib/providers/shared";

test("bounded GitHub buffering preserves exact source bytes and validates known size", async () => {
  const content = new TextEncoder().encode("small source file");
  const chunks: number[] = [];
  const data = await readAll(
    new Response(content),
    1024,
    (bytes) => chunks.push(bytes),
    new AbortController().signal,
    content.byteLength,
  );
  assert.deepEqual(Buffer.from(data), Buffer.from(content));
  assert.deepEqual(chunks, [content.byteLength]);

  await assert.rejects(
    readAll(new Response("short"), 1024, () => {}, new AbortController().signal, 6),
    /did not match/i,
  );
});

test("GitHub buffering enforces its byte ceiling even with an unknown source size", async () => {
  await assert.rejects(
    readAll(new Response("12345"), 4, () => {}, new AbortController().signal),
    /larger than the 4 bytes limit/i,
  );
});
