import { dropboxOwner } from "./owners";
import { getSession, saveSession } from "./session";
import { withTimeout } from "./timeouts";

const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

export type DropboxAuth = { token: string; accountId: string; name: string };

/** Refresh a Dropbox short-lived access token when an offline token is available. */
export async function getDropboxAuth(): Promise<DropboxAuth | null> {
  const session = await getSession();
  const account = session.dropbox;
  if (!account) return null;
  if (account.expiresAt > Date.now()) return { token: account.token, accountId: account.accountId, name: account.name };
  if (!account.refresh || !process.env.DROPBOX_CLIENT_ID || !process.env.DROPBOX_CLIENT_SECRET) {
    delete session.dropbox;
    await saveSession(session);
    return null;
  }

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DROPBOX_CLIENT_ID,
      client_secret: process.env.DROPBOX_CLIENT_SECRET,
      refresh_token: account.refresh,
      grant_type: "refresh_token",
    }),
    signal: withTimeout(undefined, 10_000),
  }).catch(() => null);
  const token = response ? ((await response.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; error?: unknown }) : {};
  if (!response?.ok || typeof token.access_token !== "string" || !token.access_token) {
    if (token.error === "invalid_grant") {
      delete session.dropbox;
      await saveSession(session);
    }
    return null;
  }
  const expiresIn = typeof token.expires_in === "number" && Number.isFinite(token.expires_in) && token.expires_in > 0 ? token.expires_in : 14_400;
  session.dropbox = {
    ...account,
    token: token.access_token,
    ...(typeof token.refresh_token === "string" && token.refresh_token ? { refresh: token.refresh_token } : {}),
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
  };
  await saveSession(session);
  return dropboxOwner(session.dropbox) ? { token: session.dropbox.token, accountId: session.dropbox.accountId, name: session.dropbox.name } : null;
}
