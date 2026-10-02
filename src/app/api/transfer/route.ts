import { createHash } from "node:crypto";
import { getGoogleAuth } from "@/lib/google";
import { encodePath, ghHeaders, REPO_RE } from "@/lib/github";
import { recordTransfer } from "@/lib/history";
import { guessName, HttpError, knownSize, mimeOf, parseHeaderLine, safeFetch, sanitizeName } from "@/lib/net";
import { allow } from "@/lib/ratelimit";
import { clientIp, getSession } from "@/lib/session";
import { GITHUB_MAX_BYTES, type TransferDone, type TransferEvent, type TransferRequest } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BUFFER_MAX = 200 * 1024 * 1024; // when the source doesn't announce a size and Drive needs one

type Emit = (e: TransferEvent) => void;
type Ctx = { b: TransferRequest; src: Response; name: string; size: number | null; emit: Emit; signal: AbortSignal };

function progressEmitter(emit: Emit, phase: "download" | "upload", total: number | null) {
  let last = 0;
  return (bytes: number, force = false) => {
    const now = Date.now();
    if (force || now - last > 150) {
      last = now;
      emit({ type: "progress", phase, bytes, total });
    }
  };
}

async function readAll(res: Response, cap: number, onBytes: (n: number) => void, signal: AbortSignal): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body!.getReader();
  try {
    for (;;) {
      if (signal.aborted) throw new HttpError("Cancelled", 499);
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > cap) throw new HttpError(`File is larger than the ${Math.round(cap / 1048576)} MB limit`, 413);
      chunks.push(value);
      onBytes(total);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  return Buffer.concat(chunks);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function splitExt(name: string): [string, string] {
  const i = name.lastIndexOf(".");
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, ""];
}

/* ------------------------------------------------------------------ GitHub */

async function toGithub(ctx: Ctx, token: string): Promise<TransferDone> {
  const { b, src, size, emit, signal } = ctx;
  const t0 = Date.now();
  let { name } = ctx;
  if (size && size > GITHUB_MAX_BYTES) {
    await src.body?.cancel().catch(() => {});
    throw new HttpError(`This file is ${(size / 1048576).toFixed(0)} MB — GitHub rejects files over 100 MB.`, 413);
  }

  let repo = b.repo;
  const created = !!b.newRepo?.name;
  if (b.newRepo?.name) {
    emit({ type: "phase", phase: "creating-repo" });
    const cr = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: ghHeaders(token),
      body: JSON.stringify({
        name: b.newRepo.name.trim(),
        private: !!b.newRepo.private,
        description: b.newRepo.description?.slice(0, 300) || undefined,
        auto_init: true,
      }),
    });
    const cj = (await cr.json()) as { full_name?: string; message?: string; errors?: { message?: string }[] };
    if (!cr.ok || !cj.full_name) {
      await src.body?.cancel().catch(() => {});
      throw new HttpError(`Could not create repo: ${cj.errors?.[0]?.message ?? cj.message ?? cr.status}`, 400);
    }
    repo = cj.full_name;
    await sleep(1500); // let GitHub finish initialising
  }
  if (!repo || !REPO_RE.test(repo)) throw new HttpError("Choose or create a repository");

  const prog = progressEmitter(emit, "download", size);
  const data = await readAll(src, GITHUB_MAX_BYTES, prog, signal);
  prog(data.length, true);
  const sha256 = createHash("sha256").update(data).digest("hex");

  const dir = (b.path ?? "").replace(/^\/+|\/+$/g, "");
  const branch = b.branch?.trim() || undefined;
  const refQ = branch ? `?ref=${encodeURIComponent(branch)}` : "";
  const apiFor = (n: string) => `https://api.github.com/repos/${repo}/contents/${encodePath((dir ? `${dir}/` : "") + n)}`;

  // Conflict handling
  const mode = b.ifExists ?? "overwrite";
  let sha: string | undefined;
  const [stem, ext] = splitExt(name);
  for (let i = 0; i < 50; i++) {
    const ex = await fetch(apiFor(name) + refQ, { headers: ghHeaders(token), signal });
    if (ex.status === 404) break;
    if (!ex.ok) break;
    const j = (await ex.json()) as { sha?: string; html_url?: string } | unknown[];
    if (Array.isArray(j)) throw new HttpError(`"${name}" is a folder in that repo`);
    if (mode === "skip") {
      return { name, url: j.html_url ?? `https://github.com/${repo}`, bytes: data.length, sha256, location: `${repo}/${dir ? dir + "/" : ""}${name}`, durationMs: Date.now() - t0, skipped: true, repo };
    }
    if (mode === "overwrite") {
      sha = j.sha;
      break;
    }
    name = `${stem} (${i + 1})${ext}`;
  }

  emit({ type: "phase", phase: "committing" });
  const message = (b.message?.trim() || `Add ${name}`).slice(0, 200);
  const body =
    `{"message":${JSON.stringify(message)},"content":"${data.toString("base64")}"` +
    (sha ? `,"sha":${JSON.stringify(sha)}` : "") +
    (branch ? `,"branch":${JSON.stringify(branch)}` : "") +
    "}";

  let put: Response | undefined;
  for (let attempt = 0; attempt < 4; attempt++) {
    put = await fetch(apiFor(name), { method: "PUT", headers: ghHeaders(token), body, signal });
    const retry = put.status === 409 || (put.status === 404 && created);
    if (!retry) break;
    await sleep(1500 * (attempt + 1));
  }
  const pj = (await put!.json().catch(() => ({}))) as { content?: { html_url?: string }; message?: string };
  if (!put!.ok) {
    const hint =
      put!.status === 404 ? " (repo/branch not found, or your token lacks write access)" :
      put!.status === 403 ? " (token lacks permission or rate-limited)" :
      put!.status === 422 ? " (branch may not exist)" : "";
    throw new HttpError(`GitHub: ${pj.message ?? put!.status}${hint}`, put!.status === 401 ? 401 : 502);
  }
  return {
    name,
    url: pj.content?.html_url ?? `https://github.com/${repo}`,
    bytes: data.length,
    sha256,
    location: `${repo}/${dir ? dir + "/" : ""}${name}`,
    durationMs: Date.now() - t0,
    repo,
  };
}

/* ------------------------------------------------------------------- Drive */

async function toDrive(ctx: Ctx, token: string): Promise<TransferDone> {
  const { b, src, name, size, emit, signal } = ctx;
  const t0 = Date.now();
  const auth = { Authorization: `Bearer ${token}` };

  let folderId = b.folderId && /^[\w-]+$/.test(b.folderId) ? b.folderId : undefined;
  let folderName = folderId ? "selected folder" : "My Drive";
  if (b.newFolder?.trim()) {
    emit({ type: "phase", phase: "creating-folder" });
    const fr = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: b.newFolder.trim().slice(0, 200), mimeType: "application/vnd.google-apps.folder" }),
      signal,
    });
    const fj = (await fr.json().catch(() => ({}))) as { id?: string; name?: string; error?: { message?: string } };
    if (!fr.ok || !fj.id) {
      await src.body?.cancel().catch(() => {});
      throw new HttpError(`Drive: could not create folder (${fj.error?.message ?? fr.status})`, 502);
    }
    folderId = fj.id;
    folderName = fj.name ?? b.newFolder.trim();
  }

  const mime = mimeOf(src);
  const init = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink,size",
    {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mime,
        ...(size ? { "X-Upload-Content-Length": String(size) } : {}),
      },
      body: JSON.stringify({ name, ...(folderId ? { parents: [folderId] } : {}) }),
      signal,
    },
  );
  const loc = init.headers.get("location");
  if (!init.ok || !loc) {
    await src.body?.cancel().catch(() => {});
    const t = await init.text().catch(() => "");
    const msg = /"message":\s*"([^"]+)"/.exec(t)?.[1] ?? init.status;
    throw new HttpError(`Drive: could not start upload (${msg})`, init.status === 401 ? 401 : 502);
  }

  const hash = createHash("sha256");
  let up: Response;
  let bytes = 0;
  if (size) {
    // True streaming: source -> (hash + progress) -> Drive. Nothing is buffered.
    const prog = progressEmitter(emit, "upload", size);
    const meter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, c) {
        hash.update(chunk);
        bytes += chunk.length;
        prog(bytes);
        c.enqueue(chunk);
      },
      flush() {
        prog(bytes, true);
      },
    });
    up = await fetch(loc, {
      method: "PUT",
      headers: { "Content-Length": String(size), "Content-Type": mime },
      body: src.body!.pipeThrough(meter) as unknown as BodyInit,
      duplex: "half",
      signal,
    } as RequestInit);
  } else {
    const prog = progressEmitter(emit, "download", null);
    const data = await readAll(src, BUFFER_MAX, prog, signal);
    prog(data.length, true);
    hash.update(data);
    bytes = data.length;
    emit({ type: "phase", phase: "uploading" });
    up = await fetch(loc, { method: "PUT", headers: { "Content-Type": mime }, body: new Uint8Array(data), signal });
  }
  const j = (await up.json().catch(() => ({}))) as { id?: string; webViewLink?: string; error?: { message?: string } };
  if (!up.ok || !j.id) throw new HttpError(`Drive: ${j.error?.message ?? up.status}`, 502);
  return {
    name,
    url: j.webViewLink ?? `https://drive.google.com/file/d/${j.id}/view`,
    bytes,
    sha256: hash.digest("hex"),
    location: `Google Drive / ${folderName} / ${name}`,
    durationMs: Date.now() - t0,
    folderId,
  };
}

/* -------------------------------------------------------------------- Route */

function jsonError(error: string, status: number) {
  return Response.json({ type: "error", error }, { status });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as TransferRequest | null;
  if (!b?.url || (b.target !== "github" && b.target !== "drive")) return jsonError("url and target are required", 400);
  if (!allow(`transfer:${clientIp(req)}`, 60, 10 * 60_000)) return jsonError("Too many transfers — try again in a few minutes", 429);

  let headers: Record<string, string>;
  try {
    headers = parseHeaderLine(b.header);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Bad header", 400);
  }

  // Resolve credentials *before* streaming (token refresh may set cookies).
  const session = await getSession();
  let token: string;
  let owner: string;
  if (b.target === "github") {
    if (!session.github) return jsonError("Log in to GitHub first", 401);
    token = session.github.token;
    owner = `github:${session.github.login}`;
  } else {
    const g = await getGoogleAuth();
    if (!g) return jsonError("Log in to Google first", 401);
    token = g.token;
    owner = `google:${g.email}`;
  }

  const ac = new AbortController();
  req.signal.addEventListener("abort", () => ac.abort());
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit: Emit = (e) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client went away */
        }
      };
      const t0 = Date.now();
      let name = b.filename?.trim() ? sanitizeName(b.filename) : "";
      let target = b.target === "github" ? "github" : "drive";
      try {
        emit({ type: "phase", phase: "connecting" });
        const { res: src, finalUrl } = await safeFetch(b.url, { headers, signal: ac.signal });
        if (!src.ok || !src.body) throw new HttpError(`Source responded with ${src.status}`, 502);
        name ||= guessName(src, finalUrl);
        const size = knownSize(src);
        emit({ type: "start", name, size, mime: mimeOf(src) });

        const ctx: Ctx = { b, src, name, size, emit, signal: ac.signal };
        const done = b.target === "github" ? await toGithub(ctx, token) : await toDrive(ctx, token);
        emit({ type: "done", ...done });
        await recordTransfer({
          owner,
          target,
          status: done.skipped ? "skipped" : "success",
          fileName: done.name,
          sourceUrl: b.url,
          location: done.location,
          resultUrl: done.url,
          bytes: done.bytes,
          sha256: done.sha256,
          durationMs: done.durationMs,
        });
      } catch (e) {
        const cancelled = ac.signal.aborted;
        const msg = cancelled ? "Cancelled" : e instanceof Error ? e.message : "Transfer failed";
        emit({ type: "error", error: msg });
        await recordTransfer({
          owner,
          target,
          status: cancelled ? "cancelled" : "failed",
          fileName: name || "download",
          sourceUrl: b.url,
          error: msg,
          durationMs: Date.now() - t0,
        });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      ac.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
  });
}
