import { NextResponse } from "next/server";
import { parseOneDriveProfile, refreshTokenForStableId } from "@/lib/identity";
import { checkState, getSession, originOf, saveSession } from "@/lib/session";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

function redirectError(origin: string, code: string) {
  return NextResponse.redirect(new URL(`/?error=${encodeURIComponent(code)}`, origin));
}

export async function GET(req: Request) {
  const origin = originOf(req);
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return redirectError(origin, "onedrive_denied");
  const code = url.searchParams.get("code");
  if (!code || !(await checkState("onedrive_state", url.searchParams.get("state")))) {
    return redirectError(origin, "onedrive_state");
  }
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  const clientSecret = process.env.ONEDRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return redirectError(origin, "onedrive_not_configured");

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${origin}/api/auth/onedrive/callback`,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return redirectError(origin, "onedrive_token");
  }
  const token = (await tokenResponse.json().catch(() => null)) as
    | { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown }
    | null;
  if (!tokenResponse.ok || typeof token?.access_token !== "string" || !token.access_token) {
    return redirectError(origin, "onedrive_token");
  }

  let profileResponse: Response;
  try {
    profileResponse = await fetch("https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return redirectError(origin, "onedrive_profile");
  }
  if (!profileResponse.ok) return redirectError(origin, "onedrive_profile");
  const profile = parseOneDriveProfile(await profileResponse.json().catch(() => null));
  if (!profile) return redirectError(origin, "onedrive_profile");

  const session = await getSession();
  const refresh = refreshTokenForStableId(
    typeof token.refresh_token === "string" ? token.refresh_token : undefined,
    session.onedrive ? { refresh: session.onedrive.refresh, id: session.onedrive.id } : undefined,
    profile.id,
  );
  const expiresIn = typeof token.expires_in === "number" && Number.isFinite(token.expires_in) && token.expires_in > 0 ? token.expires_in : 3600;
  session.onedrive = {
    token: token.access_token,
    ...(refresh ? { refresh } : {}),
    id: profile.id,
    name: profile.name,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  await saveSession(session);
  return NextResponse.redirect(new URL("/", origin));
}
