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
