import { NextResponse } from "next/server";
import { parseGitHubProfile } from "@/lib/identity";
import { checkState, getSession, originOf, saveSession } from "@/lib/session";

function redirectError(origin: string, code: string) {
  return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(code)}`, origin));
}

export async function GET(req: Request) {
  const origin = originOf(req);
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  if (!code || !(await checkState("gh_state", url.searchParams.get("state")))) {
    return redirectError(origin, "github_state");
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${origin}/api/auth/github/callback`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return redirectError(origin, "github_token");
  }
  const token = (await tokenResponse.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!tokenResponse.ok || typeof token?.access_token !== "string" || !token.access_token) {
    return redirectError(origin, "github_token");
  }

  let userResponse: Response;
  try {
    userResponse = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token.access_token}`, "User-Agent": "link-to-cloud" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return redirectError(origin, "github_profile");
  }
  if (!userResponse.ok) return redirectError(origin, "github_profile");
  const profile = parseGitHubProfile(await userResponse.json().catch(() => null));
  if (!profile) return redirectError(origin, "github_profile");

  const session = await getSession();
  session.github = { token: token.access_token, id: profile.id, login: profile.login, via: "oauth" };
  await saveSession(session);
  return NextResponse.redirect(new URL("/", origin));
}
