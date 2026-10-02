import { NextResponse } from "next/server";
import { ghHeaders } from "@/lib/github";
import { HttpError } from "@/lib/net";
import { readJsonObjectRequest } from "@/lib/http";
import { parseGitHubProfile } from "@/lib/identity";
import { allow } from "@/lib/ratelimit";
import { clientIp, getSession, isSameOriginRequest, saveSession } from "@/lib/session";

const noStore = { "Cache-Control": "no-store" };
const MAX_TOKEN_LENGTH = 512;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** Log in to GitHub with a personal access token (classic: `repo`; fine-grained: Contents + Administration write). */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return json({ error: "Cross-origin request rejected" }, 403);
  if (!allow(`token:${clientIp(req)}`, 15, 10 * 60_000)) {
    return json({ error: "Too many attempts — wait a few minutes" }, 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectRequest(req, 4096, "Token request");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return json({ error: error instanceof Error ? error.message : "Invalid request" }, status);
  }
  if (typeof body.token !== "string" || !body.token.trim()) return json({ error: "Token required" }, 400);
  const token = body.token.trim();
  if (token.length > MAX_TOKEN_LENGTH) return json({ error: "Token is too long" }, 413);

  let response: Response;
  try {
    response = await fetch("https://api.github.com/user", {
      headers: ghHeaders(token),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return json({ error: "Could not reach GitHub" }, 502);
  }
  if (response.status === 401) return json({ error: "GitHub rejected this token" }, 401);
  if (!response.ok) return json({ error: "Could not verify this GitHub token" }, 502);
  const profile = parseGitHubProfile(await response.json().catch(() => null));
  if (!profile) return json({ error: "GitHub returned an invalid account profile" }, 502);

  const session = await getSession();
  session.github = { token, id: profile.id, login: profile.login, via: "token" };
  await saveSession(session);
  return json({ ok: true, login: profile.login });
}
