import { NextResponse } from "next/server";
import { checkState, getSession, originOf, saveSession } from "@/lib/session";

export async function GET(req: Request) {
  const origin = originOf(req);
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return NextResponse.redirect(new URL("/?error=google_denied", origin));
  const code = url.searchParams.get("code");
  if (!code || !(await checkState("g_state", url.searchParams.get("state")))) {
    return NextResponse.redirect(new URL("/?error=google_state", origin));
  }
  const tr = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  const t = (await tr.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
  if (!t.access_token) return NextResponse.redirect(new URL("/?error=google_token", origin));
  if (t.scope && !t.scope.includes("drive.file")) return NextResponse.redirect(new URL("/?error=google_scope", origin));
  const ur = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${t.access_token}` },
  });
  const u = (await ur.json()) as { email?: string };
  const s = await getSession();
  s.google = {
    token: t.access_token,
    refresh: t.refresh_token ?? s.google?.refresh,
    email: u.email ?? "Google account",
    expiresAt: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000,
  };
  await saveSession(s);
  return NextResponse.redirect(new URL("/", origin));
}
