import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SOURCE_LINKS, MAX_SOURCE_TEXT_CHARS, parseSourceLinks, removeSourceLink } from "../src/lib/source-links";

test("link parser de-duplicates URLs, ignores non-URLs, and reports omitted valid links", () => {
  const links = Array.from({ length: MAX_SOURCE_LINKS + 3 }, (_, index) => `https://files.example/${index}.zip`);
  const parsed = parseSourceLinks([links[0], "not-a-link", ...links, links[0]].join("\n"));
  assert.equal(parsed.urls.length, MAX_SOURCE_LINKS);
  assert.equal(parsed.urls[0], links[0]);
  assert.equal(parsed.ignored, 1);
  assert.equal(parsed.omitted, 3);
});

test("removing a visible URL preserves ignored text and links beyond the batch cap", () => {
  const links = Array.from({ length: MAX_SOURCE_LINKS + 2 }, (_, index) => `https://files.example/${index}.zip`);
  const input = [links[0], "not-a-link", ...links].join("\n");
  const remaining = removeSourceLink(input, links[0]);
  assert.equal(remaining, ["not-a-link", ...links.slice(1)].join("\n"));
  assert.equal(parseSourceLinks(remaining).omitted, 1);
});

test("the accepted input bound is large enough for 25 maximum-length URLs", () => {
  assert.ok(MAX_SOURCE_TEXT_CHARS >= MAX_SOURCE_LINKS * 8192);
  const input = Array.from({ length: MAX_SOURCE_LINKS + 1 }, (_, index) => `https://files.example/${index}`).join("\n");
  assert.equal(parseSourceLinks(input).omitted, 1);
});
