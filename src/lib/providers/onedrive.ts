import { createHash } from "node:crypto";
import { getOneDriveAuth } from "@/lib/onedrive";
import { HttpError, mimeOf } from "@/lib/net";
import { oneDriveOwner } from "@/lib/owners";
import type { Session } from "@/lib/session";
import { withTimeout } from "@/lib/timeouts";
import type { OneDriveTransferRequest, TransferRequest } from "@/lib/types";
import type { StorageProvider } from "./types";
import { ChunkReader } from "./chunk-reader";
import { progressEmitter } from "./shared";

const GRAPH = "https://graph.microsoft.com/v1.0";
// Exactly divisible by Microsoft Graph's required 320 KiB granularity and below 60 MiB.
const CHUNK_SIZE = 10 * 1024 * 1024;

type GraphError = { error?: { message?: unknown } };
type DriveItem = { id?: unknown; name?: unknown; webUrl?: unknown };

function encodePath(folder: string | undefined, name: string): { path: string; encoded: string } {
  const segments = [...(folder ? folder.split("/") : []), name];
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0"))) {
    throw new HttpError("Invalid OneDrive destination path", 400);
  }
  const path = segments.join("/");
  return { path, encoded: segments.map((segment) => encodeURIComponent(segment)).join("/") };
}

function uploadUrl(value: unknown): string {
  if (typeof value !== "string") throw new HttpError("OneDrive did not return an upload URL", 502);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError("OneDrive returned an invalid upload URL", 502);
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" || url.username || url.password ||
    !(host === "up.1drv.com" || host.endsWith(".up.1drv.com"))
  ) {
    throw new HttpError("OneDrive returned an untrusted upload URL", 502);
  }
  return url.toString();
}

async function errorText(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as GraphError;
  const message = body.error?.message;
  return typeof message === "string" && message ? message.slice(0, 500) : `HTTP ${response.status}`;
}

function fileResult(body: DriveItem, fallback: string): { name: string; url: string } {
  return {
    name: typeof body.name === "string" && body.name ? body.name : fallback,
    url: typeof body.webUrl === "string" && body.webUrl ? body.webUrl : "https://onedrive.live.com/",
  };
}

async function uploadEmptyFile(accessToken: string, encodedPath: string, mime: string, signal: AbortSignal): Promise<DriveItem> {
  const response = await fetch(`${GRAPH}/me/drive/root:/${encodedPath}:/content`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": mime, "Content-Length": "0" },
    body: new Uint8Array(),
    signal: withTimeout(signal, 30_000),
  }).catch(() => null);
  if (!response?.ok) {
    const message = response ? await errorText(response) : "network error";
    throw new HttpError(`OneDrive could not upload the empty file: ${message}`, response?.status === 401 ? 401 : 502);
  }
  return (await response.json().catch(() => ({}))) as DriveItem;
}

function isOneDriveRequest(request: TransferRequest): request is OneDriveTransferRequest {
  return request.target === "onedrive" && !("destination" in request);
}

export const oneDriveProvider: StorageProvider = {
  id: "onedrive",
  displayName: "OneDrive",
  icon: "onedrive",
  maxFileBytes: null,
  uploadMode: "chunked-stream",

  async resolveCredentials(session: Session) {
    if (!session.onedrive) return null;
    const oneDrive = await getOneDriveAuth();
    const owner = oneDrive && oneDriveOwner(oneDrive);
    return oneDrive && owner ? { accessToken: oneDrive.token, owner } : null;
  },

  async uploadFile(context, credentials) {
    const { request, source, name, size, emit, signal } = context;
    if (!isOneDriveRequest(request)) throw new HttpError("OneDrive received an incompatible transfer request", 400);
    if (!source.body) throw new HttpError("The source did not provide a response body", 502);
    if (size === null) {
      await source.body.cancel().catch(() => {});
      throw new HttpError("OneDrive requires a source Content-Length for disk-free resumable uploads", 422);
    }
    const { path, encoded } = encodePath(request.path, name);
    const mime = mimeOf(source);
    const startedAt = Date.now();
    if (size === 0) {
      const item = await uploadEmptyFile(credentials.accessToken, encoded, mime, signal);
      const result = fileResult(item, name);
      return {
        name: result.name,
        url: result.url,
        bytes: 0,
        sha256: createHash("sha256").digest("hex"),
        location: `OneDrive / ${path}`,
        durationMs: Date.now() - startedAt,
      };
    }

    const sessionResponse = await fetch(`${GRAPH}/me/drive/root:/${encoded}:/createUploadSession`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "replace" } }),
      signal: withTimeout(signal, 30_000),
    }).catch(() => null);
    if (!sessionResponse?.ok) {
      const message = sessionResponse ? await errorText(sessionResponse) : "network error";
      await source.body.cancel().catch(() => {});
      throw new HttpError(`OneDrive could not start the upload: ${message}`, sessionResponse?.status === 401 ? 401 : 502);
    }
    const session = (await sessionResponse.json().catch(() => ({}))) as { uploadUrl?: unknown };
    const sessionUrl = uploadUrl(session.uploadUrl);
    const reader = new ChunkReader(source.body);
    const hash = createHash("sha256");
    const progress = progressEmitter(emit, "upload", size);
    let offset = 0;

    try {
      emit({ type: "phase", phase: "uploading" });
      while (offset < size) {
        const wanted = Math.min(CHUNK_SIZE, size - offset);
        const chunk = await reader.read(wanted, signal);
        if (chunk.data.byteLength !== wanted) throw new HttpError("Source size did not match its Content-Length", 502);
        const end = offset + chunk.data.byteLength - 1;
        const response = await fetch(sessionUrl, {
          method: "PUT",
          headers: {
            "Content-Length": String(chunk.data.byteLength),
            "Content-Range": `bytes ${offset}-${end}/${size}`,
            "Content-Type": "application/octet-stream",
          },
          body: chunk.data as unknown as BodyInit,
          redirect: "manual",
          signal: withTimeout(signal, 120_000),
        }).catch(() => null);
        if (!response) throw new HttpError("OneDrive upload connection was interrupted; retry the transfer", 502);
        if (end + 1 < size && response.status !== 202) {
          const message = await errorText(response);
          throw new HttpError(`OneDrive upload failed: ${message}`, response.status === 401 ? 401 : 502);
        }
        if (end + 1 === size && response.status !== 200 && response.status !== 201) {
          const message = await errorText(response);
          throw new HttpError(`OneDrive could not finalize the upload: ${message}`, response.status === 401 ? 401 : 502);
        }
        hash.update(chunk.data);
        offset += chunk.data.byteLength;
        progress(offset, true);
        if (offset === size) {
          if (await reader.hasMore(signal)) throw new HttpError("Source size did not match its Content-Length", 502);
          const result = fileResult((await response.json().catch(() => ({}))) as DriveItem, name);
          return {
            name: result.name,
            url: result.url,
            bytes: offset,
            sha256: hash.digest("hex"),
            location: `OneDrive / ${path}`,
            durationMs: Date.now() - startedAt,
          };
        }
        await response.body?.cancel().catch(() => {});
      }
      throw new HttpError("OneDrive upload ended unexpectedly", 502);
    } catch (error) {
      await reader.cancel(error);
      throw error;
    } finally {
      reader.release();
    }
  },
};
