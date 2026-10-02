import { NextResponse } from "next/server";
import { ghHeaders } from "@/lib/github";
import { allow } from "@/lib/ratelimit";
import { clientIp, getSession, saveSession } from "@/lib/session";

/** Log in to GitHub with a personal access token (classic: `repo`; fine-grained: Contents + Administration write). */
export async function POST(req: Request) {
  if (!allow(`token:${clientIp(req)}`, 15, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts — wait a few minutes" }, { status: 429 });
  }
  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  const t = token?.trim();
  if (!t) return NextResponse.json({ error: "Token required" }, { status: 400 });
  const r = await fetch("https://api.github.com/user", { headers: ghHeaders(t) }).catch(() => null);
  if (!r) return NextResponse.json({ error: "Could not reach GitHub" }, { status: 502 });
  if (!r.ok) return NextResponse.json({ error: "GitHub rejected this token" }, { status: 401 });
  const u = (await r.json()) as { login: string };
  const s = await getSession();
  s.github = { token: t, login: u.login, via: "token" };
  await saveSession(s);
  return NextResponse.json({ ok: true, login: u.login });
}
