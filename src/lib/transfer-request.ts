import { HttpError } from "@/lib/net";
import { readJsonRequest } from "@/lib/http";
import type { DriveTransferRequest, GitHubTransferRequest, TransferRequest } from "@/lib/types";

export const MAX_TRANSFER_REQUEST_BYTES = 16 * 1024;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const REPO_NAME_RE = /^[\w.-]{1,100}$/;
const DRIVE_FOLDER_ID_RE = /^[A-Za-z0-9_-]{1,256}$/;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], scope: string) {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unexpected) throw new HttpError(`Unexpected ${scope} field: ${unexpected}`);
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | undefined {
  if (!(key in value) || value[key] === undefined) return undefined;
  if (typeof value[key] !== "string") throw new HttpError(`${key} must be a string`);
  const result = value[key] as string;
  if (result.length > maxLength) throw new HttpError(`${key} is too long`);
  if (CONTROL_CHARS_RE.test(result)) throw new HttpError(`${key} contains invalid control characters`);
  return result;
}

function requiredString(value: Record<string, unknown>, key: string, maxLength: number): string {
  const result = optionalString(value, key, maxLength)?.trim();
  if (!result) throw new HttpError(`${key} is required`);
  return result;
}

function parseBase(value: Record<string, unknown>) {
  const url = requiredString(value, "url", 8192);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError("Invalid URL");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    throw new HttpError("Only public http(s) URLs without embedded credentials are supported");
  }

  const filename = optionalString(value, "filename", 200);
  const header = optionalString(value, "header", 4096);
  return {
    url,
    ...(filename !== undefined ? { filename } : {}),
    ...(header !== undefined ? { header } : {}),
  };
}

function parseGitHub(value: Record<string, unknown>): GitHubTransferRequest {
  rejectUnknownKeys(
    value,
    ["url", "target", "filename", "header", "repo", "newRepo", "branch", "path", "message", "ifExists"],
    "request",
  );
  const base = parseBase(value);
  const repo = optionalString(value, "repo", 205)?.trim();
  if (repo && (!REPO_RE.test(repo) || repo.split("/").some((part) => part === "." || part === ".."))) {
    throw new HttpError("Invalid GitHub repository");
  }

  let newRepo: GitHubTransferRequest["newRepo"];
  if (value.newRepo !== undefined) {
    if (!isRecord(value.newRepo)) throw new HttpError("newRepo must be an object");
    rejectUnknownKeys(value.newRepo, ["name", "private", "description"], "newRepo");
    const name = requiredString(value.newRepo, "name", 100);
    if (!REPO_NAME_RE.test(name) || name === "." || name === "..") throw new HttpError("Invalid new repository name");
    if (typeof value.newRepo.private !== "boolean") throw new HttpError("newRepo.private must be a boolean");
    const description = optionalString(value.newRepo, "description", 300)?.trim();
    newRepo = {
      name,
      private: value.newRepo.private,
      ...(description ? { description } : {}),
    };
  }
  if (repo && newRepo) throw new HttpError("Choose an existing repository or create a new one, not both");

  const branch = optionalString(value, "branch", 255)?.trim();
  const path = optionalString(value, "path", 1024)?.trim();
  if (path) {
    const cleanPath = path.replace(/^\/+|\/+$/g, "");
    const segments = cleanPath.split("/");
    if (
      !cleanPath ||
      segments.some((part) => !part || part === "." || part === ".." || part.length > 255 || part.includes("\\"))
    ) {
      throw new HttpError("Invalid repository folder path");
    }
  }
  const message = optionalString(value, "message", 200)?.trim();
  const ifExists = value.ifExists;
  if (ifExists !== undefined && ifExists !== "overwrite" && ifExists !== "rename" && ifExists !== "skip") {
    throw new HttpError("ifExists must be overwrite, rename, or skip");
  }

  return {
    ...base,
    target: "github",
    ...(repo ? { repo } : {}),
    ...(newRepo ? { newRepo } : {}),
    ...(branch ? { branch } : {}),
    ...(path ? { path } : {}),
    ...(message ? { message } : {}),
    ...(ifExists ? { ifExists } : {}),
  };
}

function parseDrive(value: Record<string, unknown>): DriveTransferRequest {
  rejectUnknownKeys(value, ["url", "target", "filename", "header", "folderId", "newFolder"], "request");
  const base = parseBase(value);
  const folderId = optionalString(value, "folderId", 256)?.trim();
  if (folderId && !DRIVE_FOLDER_ID_RE.test(folderId)) throw new HttpError("Invalid Google Drive folder ID");
  const newFolder = optionalString(value, "newFolder", 200)?.trim();
  if ("newFolder" in value && !newFolder) throw new HttpError("New folder name is required");
  if (folderId && newFolder) throw new HttpError("Choose an existing folder or create a new one, not both");
  return {
    ...base,
    target: "drive",
    ...(folderId ? { folderId } : {}),
    ...(newFolder ? { newFolder } : {}),
  };
}

export function validateTransferRequest(input: unknown): TransferRequest {
  if (!isRecord(input)) throw new HttpError("Request body must be a JSON object");
  if (input.target === "github") return parseGitHub(input);
  if (input.target === "drive") return parseDrive(input);
  throw new HttpError("target must be github or drive");
}

/** Read and validate a small JSON control message without trusting Content-Length. */
export async function readTransferRequest(req: Request): Promise<TransferRequest> {
  const value = await readJsonRequest(req, MAX_TRANSFER_REQUEST_BYTES, "Transfer request");
  return validateTransferRequest(value);
}
