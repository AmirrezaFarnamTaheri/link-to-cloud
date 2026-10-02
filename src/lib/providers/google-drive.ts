import { getGoogleAuth } from "@/lib/google";
import { HttpError, mimeOf } from "@/lib/net";
import type { Session } from "@/lib/session";
import type { StorageProvider } from "./types";
import { uploadResumableStream } from "./google-drive-upload";

export const googleDriveProvider: StorageProvider = {
  id: "drive",
  displayName: "Google Drive",
  icon: "drive",
  maxFileBytes: null,
  uploadMode: "chunked-stream",

  async resolveCredentials(session: Session) {
    if (!session.google) return null;
    const google = await getGoogleAuth();
    if (!google) return null;
    return { accessToken: google.token, owner: `google:${google.email}` };
  },

  async uploadFile(context, credentials) {
    const { request, source, name, size, emit, signal } = context;
    if (request.target !== "drive") throw new HttpError("Google Drive received an incompatible transfer request", 400);
    if (!source.body) throw new HttpError("The source did not provide a response body", 502);

    const t0 = Date.now();
    const authorization = { Authorization: `Bearer ${credentials.accessToken}` };
    let folderId = request.folderId;
    let folderName = folderId ? "Selected folder" : "My Drive";

    if (request.newFolder) {
      emit({ type: "phase", phase: "creating-folder" });
      const folderResponse = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: request.newFolder,
          mimeType: "application/vnd.google-apps.folder",
        }),
        signal,
      });
      const folder = (await folderResponse.json().catch(() => ({}))) as {
        id?: string;
        name?: string;
        error?: { message?: string };
      };
      if (!folderResponse.ok || !folder.id) {
        await source.body.cancel().catch(() => {});
        throw new HttpError(
          `Google Drive could not create the folder: ${folder.error?.message ?? folderResponse.status}`,
          folderResponse.status === 401 ? 401 : 502,
        );
      }
      folderId = folder.id;
      folderName = folder.name ?? request.newFolder;
    }

    const mime = mimeOf(source);
    const initResponse = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size",
      {
        method: "POST",
        headers: {
          ...authorization,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": mime,
          ...(size !== null ? { "X-Upload-Content-Length": String(size) } : {}),
        },
        body: JSON.stringify({ name, ...(folderId ? { parents: [folderId] } : {}) }),
        signal,
      },
    );
    const sessionUrl = initResponse.headers.get("location");
    if (!initResponse.ok || !sessionUrl) {
      const body = (await initResponse.json().catch(() => ({}))) as { error?: { message?: string } };
      await source.body.cancel().catch(() => {});
      throw new HttpError(
        `Google Drive could not start the upload: ${body.error?.message ?? initResponse.status}`,
        initResponse.status === 401 ? 401 : 502,
      );
    }

    emit({ type: "phase", phase: "uploading" });
    const uploaded = await uploadResumableStream({
      sessionUrl,
      source: source.body,
      expectedSize: size,
      mime,
      signal,
      emit,
    });
    const fileUrl = uploaded.file.webViewLink ?? `https://drive.google.com/file/d/${uploaded.file.id}/view`;
    return {
      name,
      url: fileUrl,
      bytes: uploaded.bytes,
      sha256: uploaded.sha256,
      location: `Google Drive / ${folderName} / ${name}`,
      durationMs: Date.now() - t0,
      folderId,
    };
  },
};
