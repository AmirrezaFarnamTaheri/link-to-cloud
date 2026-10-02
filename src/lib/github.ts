export const ghHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "relay-app",
  "Content-Type": "application/json",
});

export const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

export const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");
