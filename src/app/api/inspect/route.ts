import { NextResponse } from "next/server";
import { getGoogleAuth } from "@/lib/google";
import { guessName, HttpError, knownSize, mimeOf, parseHeaderLine, safeFetch } from "@/lib/net";
import { allow } from "@/lib/ratelimit";
import { clientIp, getSession } from "@/lib/session";
import type { InspectResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Peek at a link (name, size, type) without downloading it. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s.github && !(s.google && (await getGoogleAuth()))) {
    return NextResponse.json({ ok: false, error: "Log in first" } satisfies InspectResult, { status: 401 });
  }
  if (!allow(`inspect:${clientIp(req)}`, 120, 60_000)) {
    return NextResponse.json({ ok: false, error: "Too many requests, slow down" } satisfies InspectResult, { status: 429 });
  }
  const b = (await req.json().catch(() => ({}))) as { url?: string; header?: string };
  try {
    if (!b.url) throw new HttpError("url required");
    const headers = parseHeaderLine(b.header);
    let { res, finalUrl } = await safeFetch(b.url, { method: "HEAD", headers, timeoutMs: 12_000 });
    if (!res.ok) {
      ({ res, finalUrl } = await safeFetch(b.url, { method: "GET", headers, timeoutMs: 12_000 }));
      await res.body?.cancel().catch(() => {});
    }
    if (!res.ok) throw new HttpError(`Source responded with ${res.status}`, 502);
    const out: InspectResult = { ok: true, name: guessName(res, finalUrl), size: knownSize(res), mime: mimeOf(res), host: finalUrl.hostname };
    return NextResponse.json(out);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Could not inspect link" } satisfies InspectResult);
  }
}
