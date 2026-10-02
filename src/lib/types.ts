// Wire types shared between server routes and client components.

/**
 * Built-in destinations. Operator-installed provider modules use their own
 * lowercase ID and the extensible `PluginTransferRequest` envelope below.
 */
export type BuiltinTransferTarget = "github" | "drive" | "onedrive" | "dropbox";
export type TransferTarget = BuiltinTransferTarget;

export type ProviderIcon = "github" | "drive" | "onedrive" | "dropbox" | "cloud";

/** A safe, declarative destination input that a plugin may expose in the UI. */
export type ProviderDestinationField = {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
};

export type ProviderInfo = {
  id: string;
  displayName: string;
  icon: ProviderIcon;
  maxFileBytes: number | null;
  uploadMode: "buffered" | "chunked-stream";
  /** Fields rendered by the generic destination UI for an operator-installed plugin. */
  destinationFields?: ProviderDestinationField[];
};

export type SessionInfo = {
  github: { login: string; via: "oauth" | "token" } | null;
  google: { email: string } | null;
  onedrive: { name: string } | null;
  dropbox: { name: string } | null;
  /** Providers for which the current user has usable credentials. */
  connectedProviders: string[];
  config: {
    githubOAuth: boolean;
    googleOAuth: boolean;
    oneDriveOAuth: boolean;
    dropboxOAuth: boolean;
  };
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
  | { type: "destination-created"; target: "plugin"; provider: string; destination: string }
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

/** Upload to a path below the connected user's OneDrive root. */
export type OneDriveTransferRequest = TransferBase & {
  target: "onedrive";
  path?: string;
};

/** Upload to a path below the connected user's Dropbox root. */
export type DropboxTransferRequest = TransferBase & {
  target: "dropbox";
  path?: string;
};

/**
 * The constrained request envelope accepted by an operator-installed provider.
 * Plugins receive only their already-validated `destination` object; they never
 * receive arbitrary top-level control fields.
 */
/** A validated operator-provider reference. Prefixing avoids colliding with built-in discriminated targets. */
export type PluginTarget = `plugin:${string}`;

export type PluginTransferRequest = TransferBase & {
  target: PluginTarget;
  destination: Record<string, string>;
};

export type TransferRequest =
  | GitHubTransferRequest
  | DriveTransferRequest
  | OneDriveTransferRequest
  | DropboxTransferRequest
  | PluginTransferRequest;

export type HistoryItem = {
  id: string;
  target: string;
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
