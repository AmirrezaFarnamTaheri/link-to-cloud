// Wire types shared between server routes and client components.

export type TransferTarget = "github" | "drive";

export type ProviderInfo = {
  id: TransferTarget;
  displayName: string;
  icon: "github" | "drive";
  maxFileBytes: number | null;
  uploadMode: "buffered" | "chunked-stream";
};

export type SessionInfo = {
  github: { login: string; via: "oauth" | "token" } | null;
  google: { email: string } | null;
  config: { githubOAuth: boolean; googleOAuth: boolean };
};

export type Repo = { name: string; private: boolean; defaultBranch: string };
export type DriveFolder = { id: string; name: string };

export type InspectResult =
  | { ok: true; name: string; size: number | null; mime: string; host: string }
  | { ok: false; error: string };

export type TransferDone = {
  name: string;
  url: string;
  bytes: number | null;
  sha256: string | null;
  location: string;
  durationMs: number;
  skipped?: boolean;
  repo?: string;
  folderId?: string;
};

export type TransferEvent =
  | { type: "start"; name: string; size: number | null; mime: string }
  | { type: "phase"; phase: "connecting" | "creating-repo" | "creating-folder" | "committing" | "uploading" }
  | { type: "destination-created"; target: "github"; repo: string }
  | { type: "destination-created"; target: "drive"; folderId: string }
  | { type: "progress"; phase: "download" | "upload"; bytes: number; total: number | null }
  | ({ type: "done" } & TransferDone)
  | { type: "error"; error: string };

export type TransferBase = {
  url: string;
  filename?: string;
  header?: string;
};

export type GitHubTransferRequest = TransferBase & {
  target: "github";
  repo?: string;
  newRepo?: { name: string; private: boolean; description?: string };
  branch?: string;
  path?: string;
  message?: string;
  ifExists?: "overwrite" | "rename" | "skip";
};

export type DriveTransferRequest = TransferBase & {
  target: "drive";
  folderId?: string;
  newFolder?: string;
};

export type TransferRequest = GitHubTransferRequest | DriveTransferRequest;

export type HistoryItem = {
  id: string;
  target: TransferTarget;
  status: "success" | "skipped" | "failed" | "cancelled";
  fileName: string;
  sourceUrl: string;
  location: string | null;
  resultUrl: string | null;
  bytes: number | null;
  sha256: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
};

export const GITHUB_MAX_BYTES = 100 * 1024 * 1024;
export const GITHUB_WARN_BYTES = 50 * 1024 * 1024;
