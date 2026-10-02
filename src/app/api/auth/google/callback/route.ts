import { NextResponse } from "next/server";
import { parseGoogleProfile, refreshTokenForIdentity } from "@/lib/identity";
import { checkState, getSession, originOf, saveSession } from "@/lib/session";

function redirectError(origin: string, code: string) {
  return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(code)}`, origin));
}

export async function GET(req: Request) {
  const origin = originOf(req);
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return redirectError(origin, "google_denied");
  const code = url.searchParams.get("code");
  if (!code || !(await checkState("g_state", url.searchParams.get("state")))) {
    return redirectError(origin, "google_state");
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        redirect_uri: `${origin}/api/auth/google/callback`,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return redirectError(origin, "google_token");
  }
  const token = (await tokenResponse.json().catch(() => null)) as
    | { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown }
    | null;
  if (!tokenResponse.ok || typeof token?.access_token !== "string" || !token.access_token) {
    return redirectError(origin, "google_token");
  }
  const driveScope = "https://www.googleapis.com/auth/drive.file";
  if (typeof token.scope === "string" && !token.scope.split(/\s+/).includes(driveScope)) {
    return redirectError(origin, "google_scope");
  }

  let userResponse: Response;
  try {
    userResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return redirectError(origin, "google_profile");
  }
  if (!userResponse.ok) return redirectError(origin, "google_profile");
  const profile = parseGoogleProfile(await userResponse.json().catch(() => null));
  if (!profile) return redirectError(origin, "google_profile");

  const session = await getSession();
  const refresh = refreshTokenForIdentity(
    typeof token.refresh_token === "string" ? token.refresh_token : undefined,
    session.google,
    profile,
  );
  const expiresIn = typeof token.expires_in === "number" && Number.isFinite(token.expires_in) && token.expires_in > 0 ? token.expires_in : 3600;
  session.google = {
    token: token.access_token,
    ...(refresh ? { refresh } : {}),
    email: profile.email,
    sub: profile.sub,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  await saveSession(session);
  return NextResponse.redirect(new URL("/", origin));
}
