import { oneDriveOwner } from "./owners";
import { getSession, saveSession } from "./session";
import { withTimeout } from "./timeouts";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export type OneDriveAuth = { token: string; id: string; name: string };

/** Refresh a Microsoft Graph access token when possible; invalid grants disconnect only OneDrive. */
export async function getOneDriveAuth(): Promise<OneDriveAuth | null> {
  const session = await getSession();
  const account = session.onedrive;
  if (!account) return null;
  if (account.expiresAt > Date.now()) return { token: account.token, id: account.id, name: account.name };
  if (!account.refresh || !process.env.ONEDRIVE_CLIENT_ID || !process.env.ONEDRIVE_CLIENT_SECRET) {
    delete session.onedrive;
    await saveSession(session);
    return null;
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ONEDRIVE_CLIENT_ID,
      client_secret: process.env.ONEDRIVE_CLIENT_SECRET,
      refresh_token: account.refresh,
      grant_type: "refresh_token",
    }),
    signal: withTimeout(undefined, 10_000),
  }).catch(() => null);
  const token = response ? ((await response.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown }) : {};
  if (!response?.ok || typeof token.access_token !== "string" || !token.access_token) {
    if (token.error === "invalid_grant") {
      delete session.onedrive;
      await saveSession(session);
    }
    return null;
  }
  const expiresIn = typeof token.expires_in === "number" && Number.isFinite(token.expires_in) && token.expires_in > 0 ? token.expires_in : 3600;
  session.onedrive = {
    ...account,
    token: token.access_token,
    ...(typeof token.refresh_token === "string" && token.refresh_token ? { refresh: token.refresh_token } : {}),
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  await saveSession(session);
  return oneDriveOwner(session.onedrive) ? { token: session.onedrive.token, id: session.onedrive.id, name: session.onedrive.name } : null;
}
