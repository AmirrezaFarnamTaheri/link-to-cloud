import { createHash } from "node:crypto";
import { getDropboxAuth } from "@/lib/dropbox";
import { HttpError } from "@/lib/net";
import { dropboxOwner } from "@/lib/owners";
import type { Session } from "@/lib/session";
import { withTimeout } from "@/lib/timeouts";
import type { DropboxTransferRequest, TransferRequest } from "@/lib/types";
import type { StorageProvider } from "./types";
import { ChunkReader } from "./chunk-reader";
import { progressEmitter } from "./shared";

const CONTENT_API = "https://content.dropboxapi.com/2/files";
const CHUNK_SIZE = 8 * 1024 * 1024;

type DropboxError = { error_summary?: unknown; error?: { ".tag"?: unknown; correct_offset?: unknown } };

type DropboxEntry = { id?: unknown; name?: unknown; path_display?: unknown };

function apiHeaders(accessToken: string, arg: unknown) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/octet-stream",
    "Dropbox-API-Arg": JSON.stringify(arg),
  };
}

async function errorText(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as DropboxError;
  const summary = typeof body.error_summary === "string" ? body.error_summary : "";
  return summary ? summary.slice(0, 500) : `HTTP ${response.status}`;
}

function checkedPath(folder: string | undefined, name: string): string {
  const combined = [folder, name].filter(Boolean).join("/");
  const path = `/${combined}`;
  if (path.length > 4096 || path.split("/").some((part) => part === "." || part === ".." || part.includes("\0"))) {
    throw new HttpError("Invalid Dropbox destination path", 400);
  }
  return path;
}

function entryResult(entry: DropboxEntry, path: string) {
  const actualPath = typeof entry.path_display === "string" && entry.path_display ? entry.path_display : path;
  const name = typeof entry.name === "string" && entry.name ? entry.name : path.split("/").at(-1) ?? "upload";
  return { name, path: actualPath };
}

function isDropboxRequest(request: TransferRequest): request is DropboxTransferRequest {
  return request.target === "dropbox" && !("destination" in request);
}

export const dropboxProvider: StorageProvider = {
  id: "dropbox",
  displayName: "Dropbox",
  icon: "dropbox",
  maxFileBytes: null,
  uploadMode: "chunked-stream",

  async resolveCredentials(session: Session) {
    if (!session.dropbox) return null;
    const dropbox = await getDropboxAuth();
    const owner = dropbox && dropboxOwner(dropbox);
    return dropbox && owner ? { accessToken: dropbox.token, owner } : null;
  },

  async uploadFile(context, credentials) {
    const { request, source, name, size, emit, signal } = context;
    if (!isDropboxRequest(request)) throw new HttpError("Dropbox received an incompatible transfer request", 400);
    if (!source.body) throw new HttpError("The source did not provide a response body", 502);
    const path = checkedPath(request.path, name);
    const startedAt = Date.now();
    const reader = new ChunkReader(source.body);
    const hash = createHash("sha256");
    const progress = progressEmitter(emit, "upload", size);
    let offset = 0;

    try {
      const start = await fetch(`${CONTENT_API}/upload_session/start`, {
        method: "POST",
        headers: apiHeaders(credentials.accessToken, { close: false }),
        body: new Uint8Array(),
        signal: withTimeout(signal, 30_000),
      }).catch(() => null);
      const started = start ? ((await start.json().catch(() => ({}))) as { session_id?: unknown }) : {};
      if (!start?.ok || typeof started.session_id !== "string" || !started.session_id) {
        throw new HttpError(`Dropbox could not start the upload: ${start ? "invalid response" : "network error"}`, 502);
      }
      const sessionId = started.session_id;

      for (;;) {
        const chunk = await reader.read(CHUNK_SIZE, signal);
        if (chunk.data.byteLength) {
          const response = await fetch(`${CONTENT_API}/upload_session/append_v2`, {
            method: "POST",
            headers: apiHeaders(credentials.accessToken, { cursor: { session_id: sessionId, offset }, close: false }),
            body: chunk.data as unknown as BodyInit,
            signal: withTimeout(signal, 120_000),
          }).catch(() => null);
          if (!response?.ok) {
            const message = response ? await errorText(response) : "network error";
            throw new HttpError(`Dropbox upload failed: ${message}`, response?.status === 401 ? 401 : 502);
          }
          await response.body?.cancel().catch(() => {});
          hash.update(chunk.data);
          offset += chunk.data.byteLength;
          progress(offset, true);
        }
        if (chunk.ended) break;
      }
      if (size !== null && offset !== size) throw new HttpError("Source size did not match its Content-Length", 502);

      const finish = await fetch(`${CONTENT_API}/upload_session/finish`, {
        method: "POST",
        headers: apiHeaders(credentials.accessToken, {
          cursor: { session_id: sessionId, offset },
          commit: { path, mode: "add", autorename: true, mute: false, strict_conflict: false },
        }),
        body: new Uint8Array(),
        signal: withTimeout(signal, 120_000),
      }).catch(() => null);
      if (!finish?.ok) {
        const message = finish ? await errorText(finish) : "network error";
        throw new HttpError(`Dropbox could not finish the upload: ${message}`, finish?.status === 401 ? 401 : 502);
      }
      const entry = entryResult((await finish.json().catch(() => ({}))) as DropboxEntry, path);
      progress(offset, true);
      return {
        name: entry.name,
        url: "https://www.dropbox.com/home",
        bytes: offset,
        sha256: hash.digest("hex"),
        location: `Dropbox ${entry.path}`,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      await reader.cancel(error);
      throw error;
    } finally {
      reader.release();
    }
  },
};
