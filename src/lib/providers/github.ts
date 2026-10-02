import { createHash } from "node:crypto";
import { ghHeaders, encodePath, REPO_RE } from "@/lib/github";
import { HttpError } from "@/lib/net";
import type { Session } from "@/lib/session";
import { GITHUB_MAX_BYTES } from "@/lib/types";
import type { StorageProvider } from "./types";
import { abortableSleep, progressEmitter, readAll, splitExtension } from "./shared";

export const githubProvider: StorageProvider = {
  id: "github",
  displayName: "GitHub",
  icon: "github",
  maxFileBytes: GITHUB_MAX_BYTES,
  uploadMode: "buffered",

  async resolveCredentials(session: Session) {
    if (!session.github) return null;
    return { accessToken: session.github.token, owner: `github:${session.github.login}` };
  },

  async uploadFile(context, credentials) {
    const { request, source, size, emit, signal } = context;
    if (request.target !== "github") throw new HttpError("GitHub received an incompatible transfer request", 400);
    const t0 = Date.now();
    let { name } = context;
    if (size !== null && size > GITHUB_MAX_BYTES) {
      await source.body?.cancel().catch(() => {});
      throw new HttpError(`This file is ${(size / 1048576).toFixed(0)} MB — GitHub rejects files over 100 MB.`, 413);
    }

    let repo = request.repo;
    const created = !!request.newRepo?.name;
    if (request.newRepo?.name) {
      emit({ type: "phase", phase: "creating-repo" });
      const response = await fetch("https://api.github.com/user/repos", {
        method: "POST",
        headers: ghHeaders(credentials.accessToken),
        body: JSON.stringify({
          name: request.newRepo.name,
          private: request.newRepo.private,
          description: request.newRepo.description || undefined,
          auto_init: true,
        }),
        signal,
      });
      const body = (await response.json().catch(() => ({}))) as {
        full_name?: string;
        message?: string;
        errors?: { message?: string }[];
      };
      if (!response.ok || !body.full_name) {
        await source.body?.cancel().catch(() => {});
        throw new HttpError(
          `Could not create repo: ${body.errors?.[0]?.message ?? body.message ?? response.status}`,
          response.status === 401 ? 401 : 400,
        );
      }
      repo = body.full_name;
      await abortableSleep(1500, signal);
    }
    if (!repo || !REPO_RE.test(repo) || repo.split("/").some((part) => part === "." || part === "..")) {
      throw new HttpError("Choose or create a repository");
    }

    const downloadProgress = progressEmitter(emit, "download", size);
    const data = await readAll(source, GITHUB_MAX_BYTES, downloadProgress, signal);
    downloadProgress(data.byteLength, true);
    const sha256 = createHash("sha256").update(data).digest("hex");

    const directory = (request.path ?? "").replace(/^\/+|\/+$/g, "");
    const branch = request.branch?.trim() || undefined;
    const refQuery = branch ? `?ref=${encodeURIComponent(branch)}` : "";
    const apiFor = (fileName: string) =>
      `https://api.github.com/repos/${repo}/contents/${encodePath((directory ? `${directory}/` : "") + fileName)}`;

    const mode = request.ifExists ?? "overwrite";
    let existingSha: string | undefined;
    const [stem, extension] = splitExtension(name);
    let candidateAvailable = false;
    for (let index = 0; index <= 50; index++) {
      const existing = await fetch(apiFor(name) + refQuery, {
        headers: ghHeaders(credentials.accessToken),
        signal,
      });
      if (existing.status === 404) {
        await existing.body?.cancel().catch(() => {});
        candidateAvailable = true;
        break;
      }
      if (!existing.ok) {
        await existing.body?.cancel().catch(() => {});
        throw new HttpError(`GitHub could not check the destination file (HTTP ${existing.status})`, 502);
      }
      const body = (await existing.json()) as { sha?: string; html_url?: string } | unknown[];
      if (Array.isArray(body)) throw new HttpError(`"${name}" is a folder in that repository`);
      if (mode === "skip") {
        return {
          name,
          url: body.html_url ?? `https://github.com/${repo}`,
          bytes: data.byteLength,
          sha256,
          location: `${repo}/${directory ? `${directory}/` : ""}${name}`,
          durationMs: Date.now() - t0,
          skipped: true,
          repo,
        };
      }
      if (mode === "overwrite") {
        if (!body.sha) throw new HttpError("GitHub did not return the existing file version", 502);
        existingSha = body.sha;
        candidateAvailable = true;
        break;
      }
      if (index === 50) break;
      name = `${stem} (${index + 1})${extension}`;
    }
    if (!candidateAvailable) throw new HttpError("Could not find an unused filename after 51 candidates", 409);

    emit({ type: "phase", phase: "committing" });
    const message = (request.message?.trim() || `Add ${name}`).slice(0, 200);
    const body = JSON.stringify({
      message,
      content: data.toString("base64"),
      ...(existingSha ? { sha: existingSha } : {}),
      ...(branch ? { branch } : {}),
    });

    let response: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt++) {
      response = await fetch(apiFor(name), {
        method: "PUT",
        headers: ghHeaders(credentials.accessToken),
        body,
        signal,
      });
      const shouldRetry = response.status === 409 || (response.status === 404 && created);
      if (!shouldRetry) break;
      await response.body?.cancel().catch(() => {});
      if (attempt < 3) await abortableSleep(1500 * (attempt + 1), signal);
    }
    const result = (await response!.json().catch(() => ({}))) as {
      content?: { html_url?: string };
      message?: string;
    };
    if (!response!.ok) {
      const hint =
        response!.status === 404 ? " (repo/branch not found, or your token lacks write access)" :
        response!.status === 403 ? " (token lacks permission or rate-limited)" :
        response!.status === 422 ? " (branch may not exist)" : "";
      throw new HttpError(
        `GitHub: ${result.message ?? response!.status}${hint}`,
        response!.status === 401 ? 401 : 502,
      );
    }

    return {
      name,
      url: result.content?.html_url ?? `https://github.com/${repo}`,
      bytes: data.byteLength,
      sha256,
      location: `${repo}/${directory ? `${directory}/` : ""}${name}`,
      durationMs: Date.now() - t0,
      repo,
    };
  },
};
