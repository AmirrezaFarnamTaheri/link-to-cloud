import { NextResponse } from "next/server";
import { getGoogleAuth } from "@/lib/google";
import { readJsonObjectRequest } from "@/lib/http";
import { githubOwner } from "@/lib/owners";
import { guessName, HttpError, knownSize, mimeOf, parseHeaderLine, safeFetch } from "@/lib/net";
import { allow } from "@/lib/ratelimit";
import { clientIp, getSession, isSameOriginRequest } from "@/lib/session";
import type { InspectResult } from "@/lib/types";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** Peek at a link (name, size, type) without downloading it. */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return json({ ok: false, error: "Cross-origin request rejected" } satisfies InspectResult, 403);

  const session = await getSession();
  const github = session.github ? githubOwner(session.github) : null;
  if (!github && !(session.google && (await getGoogleAuth())) && !session.onedrive && !session.dropbox) {
    return json({ ok: false, error: "Log in first" } satisfies InspectResult, 401);
  }
  if (!allow(`inspect:${clientIp(req)}`, 120, 60_000)) {
    return json({ ok: false, error: "Too many requests, slow down" } satisfies InspectResult, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectRequest(req, 16 * 1024, "Inspection request");
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Invalid request" } satisfies InspectResult,
      error instanceof HttpError ? error.status : 400,
    );
  }
  if (typeof body.url !== "string" || !body.url.trim()) {
    return json({ ok: false, error: "url required" } satisfies InspectResult, 400);
  }
  const link = body.url.trim();
  if (link.length > 8192) return json({ ok: false, error: "url is too long" } satisfies InspectResult, 400);
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(link);
  } catch {
    return json({ ok: false, error: "Invalid URL" } satisfies InspectResult, 400);
  }
  if ((parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") || parsedUrl.username || parsedUrl.password) {
    return json({ ok: false, error: "Only http(s) URLs without embedded credentials are supported" } satisfies InspectResult, 400);
  }
  if (body.header !== undefined && typeof body.header !== "string") {
    return json({ ok: false, error: "header must be a string" } satisfies InspectResult, 400);
  }
  if (typeof body.header === "string" && body.header.length > 4096) {
    return json({ ok: false, error: "header is too long" } satisfies InspectResult, 400);
  }

  try {
    const headers = parseHeaderLine(body.header as string | undefined);
    let fetched = await safeFetch(link, { method: "HEAD", headers, timeoutMs: 12_000 });
    if (!fetched.res.ok) {
      await fetched.res.body?.cancel().catch(() => {});
      fetched = await safeFetch(link, { method: "GET", headers, timeoutMs: 12_000 });
      await fetched.res.body?.cancel().catch(() => {});
    }
    const { res, finalUrl } = fetched;
    if (!res.ok) throw new HttpError(`Source responded with ${res.status}`, 502);
    const out: InspectResult = { ok: true, name: guessName(res, finalUrl), size: knownSize(res), mime: mimeOf(res), host: finalUrl.hostname };
    return json(out);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502;
    return json({ ok: false, error: error instanceof Error ? error.message : "Could not inspect link" } satisfies InspectResult, status);
  }
}
