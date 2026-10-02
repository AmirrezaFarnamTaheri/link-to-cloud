export const MAX_SOURCE_LINKS = 25;
export const MAX_SOURCE_TEXT_CHARS = 256 * 1024;

export type ParsedSourceLinks = { urls: string[]; ignored: number; omitted: number };

/** Remove a selected URL token while retaining ignored text and links beyond the visible batch cap. */
export function removeSourceLink(text: string, url: string): string {
  return text.split(/\s+/).filter((token) => token && token !== url).join("\n");
}

/** Keep duplicate links out of a batch and report valid links beyond the server-supported cap. */
export function parseSourceLinks(text: string, maxLinks = MAX_SOURCE_LINKS): ParsedSourceLinks {
  const seen = new Set<string>();
  const urls: string[] = [];
  let ignored = 0;
  let omitted = 0;

  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (!/^https?:\/\/\S+$/i.test(token)) {
      ignored++;
      continue;
    }
    if (seen.has(token)) continue;
    seen.add(token);
    if (urls.length < maxLinks) urls.push(token);
    else omitted++;
  }

  return { urls, ignored, omitted };
}
