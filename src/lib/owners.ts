import type { Session } from "./session";

type GitHubIdentity = { id?: number; login: string };
type GoogleIdentity = { sub?: string; email: string };
type StableIdentity = { id: string };
type DropboxIdentity = { accountId: string };

export function githubOwner(identity: GitHubIdentity): string | null {
  if (Number.isSafeInteger(identity.id) && (identity.id ?? 0) > 0) return `github:id:${identity.id}`;
  const login = identity.login.trim();
  return login && login.toLowerCase() !== "unknown" ? `github:${login}` : null;
}

export function googleOwner(identity: GoogleIdentity): string | null {
  const sub = identity.sub?.trim();
  if (sub) return `google:sub:${sub}`;
  const email = identity.email.trim();
  return email && email.toLowerCase() !== "google account" ? `google:${email}` : null;
}

export function oneDriveOwner(identity: StableIdentity): string | null {
  const id = identity.id.trim();
  return id ? `onedrive:id:${id}` : null;
}

export function dropboxOwner(identity: DropboxIdentity): string | null {
  const id = identity.accountId.trim();
  return id ? `dropbox:id:${id}` : null;
}

/** Use mutable names/emails only for legacy sessions that lack immutable provider IDs. */
export function sessionOwnerKeys(session: Session): string[] {
  const owners: string[] = [];
  if (session.github) {
    const stable = githubOwner(session.github);
    if (stable) owners.push(stable);
    if (!Number.isSafeInteger(session.github.id) || (session.github.id ?? 0) <= 0) {
      const login = session.github.login.trim();
      if (login && login.toLowerCase() !== "unknown") owners.push(`github:${login}`);
    }
  }
  if (session.google) {
    const stable = googleOwner(session.google);
    if (stable) owners.push(stable);
    if (!session.google.sub?.trim()) {
      const email = session.google.email.trim();
      if (email && email.toLowerCase() !== "google account") owners.push(`google:${email}`);
    }
  }
  if (session.onedrive) {
    const stable = oneDriveOwner(session.onedrive);
    if (stable) owners.push(stable);
  }
  if (session.dropbox) {
    const stable = dropboxOwner(session.dropbox);
    if (stable) owners.push(stable);
  }
  return [...new Set(owners)];
}
