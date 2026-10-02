import { NextResponse } from "next/server";
import { checkState, getSession, originOf, saveSession } from "@/lib/session";

export async function GET(req: Request) {
  const origin = originOf(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code || !(await checkState("gh_state", url.searchParams.get("state")))) {
    return NextResponse.redirect(new URL("/?error=github_state", origin));
  }
  const tr = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${origin}/api/auth/github/callback`,
    }),
  });
  const t = (await tr.json()) as { access_token?: string };
  if (!t.access_token) return NextResponse.redirect(new URL("/?error=github_token", origin));
  const ur = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${t.access_token}`, "User-Agent": "dl2cloud" },
  });
  const u = (await ur.json()) as { login?: string };
  const s = await getSession();
  s.github = { token: t.access_token, login: u.login ?? "unknown", via: "oauth" };
  await saveSession(s);
  return NextResponse.redirect(new URL("/", origin));
}
