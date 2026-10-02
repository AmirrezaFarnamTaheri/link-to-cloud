type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type GitHubProfile = { id: number; login: string };

export function parseGitHubProfile(value: unknown): GitHubProfile | null {
  if (!isRecord(value)) return null;
  const { id, login } = value;
  if (
    typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 ||
    typeof login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(login)
  ) {
    return null;
  }
  return { id, login };
}

export type GoogleProfile = { sub: string; email: string };

export function parseGoogleProfile(value: unknown): GoogleProfile | null {
  if (!isRecord(value)) return null;
  const { sub, email } = value;
  if (
    typeof sub !== "string" || !sub.trim() || sub.length > 255 || /[\u0000-\u001f\u007f]/.test(sub) ||
    typeof email !== "string" || email.trim().length > 320 || !/^[^\s@]+@[^\s@]+$/.test(email.trim())
  ) {
    return null;
  }
  return { sub: sub.trim(), email: email.trim() };
}

/** Reuse an old refresh token only when it is bound to the same immutable Google subject. */
export function refreshTokenForIdentity(
  newToken: string | undefined,
  previous: { refresh?: string; sub?: string; email: string } | undefined,
  next: GoogleProfile,
): string | undefined {
  if (newToken?.trim()) return newToken;
  if (!previous?.refresh || !previous.sub || previous.sub !== next.sub) return undefined;
  return previous.refresh;
}

export type OneDriveProfile = { id: string; name: string };

export function parseOneDriveProfile(value: unknown): OneDriveProfile | null {
  if (!isRecord(value)) return null;
  const { id, displayName, userPrincipalName } = value;
  if (typeof id !== "string" || !id.trim() || id.length > 255 || /[\u0000-\u001f\u007f]/.test(id)) return null;
  const name = typeof displayName === "string" && displayName.trim() ? displayName.trim() : userPrincipalName;
  if (typeof name !== "string" || !name.trim() || name.length > 320 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return { id: id.trim(), name: name.trim() };
}

export type DropboxProfile = { accountId: string; name: string };

export function parseDropboxProfile(value: unknown): DropboxProfile | null {
  if (!isRecord(value)) return null;
  const { account_id: accountId, name } = value;
  const displayName = isRecord(name) ? name.display_name : undefined;
  if (
    typeof accountId !== "string" || !accountId.trim() || accountId.length > 255 || /[\u0000-\u001f\u007f]/.test(accountId) ||
    typeof displayName !== "string" || !displayName.trim() || displayName.length > 320 || /[\u0000-\u001f\u007f]/.test(displayName)
  ) {
    return null;
  }
  return { accountId: accountId.trim(), name: displayName.trim() };
}

/** Reuse a refresh token only when the provider returned the same stable account identifier. */
export function refreshTokenForStableId(
  newToken: string | undefined,
  previous: { refresh?: string; id: string } | undefined,
  id: string,
): string | undefined {
  if (newToken?.trim()) return newToken;
  return previous?.refresh && previous.id === id ? previous.refresh : undefined;
}
