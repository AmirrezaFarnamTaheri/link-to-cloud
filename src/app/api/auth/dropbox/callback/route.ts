import { NextResponse } from "next/server";
import { parseDropboxProfile, refreshTokenForStableId } from "@/lib/identity";
import { checkState, getSession, originOf, saveSession } from "@/lib/session";

const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

function redirectError(origin: string, code: string) {
  return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(code)}`, origin));
}

export async function GET(req: Request) {
  const origin = originOf(req);
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return redirectError(origin, "dropbox_denied");
  const code = url.searchParams.get("code");
  if (!code || !(await checkState("dropbox_state", url.searchParams.get("state")))) {
    return redirectError(origin, "dropbox_state");
  }
  const clientId = process.env.DROPBOX_CLIENT_ID;
  const clientSecret = process.env.DROPBOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return redirectError(origin, "dropbox_not_configured");

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/auth/dropbox/callback`,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return redirectError(origin, "dropbox_token");
  }
  const token = (await tokenResponse.json().catch(() => null)) as
    | { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
    | null;
  if (!tokenResponse.ok || typeof token?.access_token !== "string" || !token.access_token) {
    return redirectError(origin, "dropbox_token");
  }

  let profileResponse: Response;
  try {
    profileResponse = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return redirectError(origin, "dropbox_profile");
  }
  if (!profileResponse.ok) return redirectError(origin, "dropbox_profile");
  const profile = parseDropboxProfile(await profileResponse.json().catch(() => null));
  if (!profile) return redirectError(origin, "dropbox_profile");

  const session = await getSession();
  const refresh = refreshTokenForStableId(
    typeof token.refresh_token === "string" ? token.refresh_token : undefined,
    session.dropbox ? { refresh: session.dropbox.refresh, id: session.dropbox.accountId } : undefined,
    profile.accountId,
  );
  const expiresIn = typeof token.expires_in === "number" && Number.isFinite(token.expires_in) && token.expires_in > 0 ? token.expires_in : 14_400;
  session.dropbox = {
    token: token.access_token,
    ...(refresh ? { refresh } : {}),
    accountId: profile.accountId,
    name: profile.name,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  await saveSession(session);
  return NextResponse.redirect(new URL("/", origin));
}
