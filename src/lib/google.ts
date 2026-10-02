import { googleOwner } from "./owners";
import { getSession, saveSession } from "./session";
import { withTimeout } from "./timeouts";

export type GoogleAuth = { token: string; email: string; sub?: string };

/**
 * Returns a valid Google access token, transparently refreshing it with the
 * stored refresh token. Must be called from a route handler (it may set cookies).
 */
export async function getGoogleAuth(): Promise<GoogleAuth | null> {
  const s = await getSession();
  const g = s.google;
  if (!g) return null;
  if (g.expiresAt > Date.now()) return { token: g.token, email: g.email, sub: g.sub };

  if (!g.refresh) {
    delete s.google;
    await saveSession(s);
    return null;
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      refresh_token: g.refresh,
      grant_type: "refresh_token",
    }),
    signal: withTimeout(undefined, 10_000),
  }).catch(() => null);
  const j = r ? ((await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string }) : {};
  if (!r?.ok || !j.access_token) {
    if (j.error === "invalid_grant") {
      delete s.google;
      await saveSession(s);
    }
    return null;
  }
  s.google = { ...g, token: j.access_token, expiresAt: Date.now() + ((j.expires_in ?? 3600) - 60) * 1000 };
  await saveSession(s);
  return { token: j.access_token, email: g.email, sub: g.sub };
}

export async function revokeGoogle(token: string) {
  try {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: withTimeout(undefined, 10_000),
    });
    await response.body?.cancel().catch(() => {});
  } catch {
    // Clearing the local session must not depend on the revocation endpoint being available.
  }
}
