"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GITHUB_MAX_BYTES,
  GITHUB_WARN_BYTES,
  type InspectResult,
  type ProviderInfo,
  type SessionInfo,
  type TransferDone,
  type TransferEvent,
  type TransferRequest,
} from "@/lib/types";
import { Accounts } from "./accounts";
import { defaultDest, Destination, REPO_NAME_RE, type Dest } from "./destination";
import { History } from "./history";
import {
  btnGhost,
  btnPrimary,
  card,
  cx,
  field,
  formatBytes,
  formatDuration,
  IconAlert,
  IconBan,
  IconChevron,
  IconCheck,
  IconCloudUp,
  IconCopy,
  IconExternal,
  IconFile,
  IconLink,
  IconX,
  label,
  ProgressBar,
  Spinner,
} from "./ui";

type Run = {
  status: "queued" | "running" | "done" | "error" | "cancelled";
  phase?: string;
  kind?: "download" | "upload";
  name?: string;
  bytes: number;
  total: number | null;
  speed: number;
  result?: TransferDone;
  error?: string;
};

const MAX_LINKS = 25;
const PREFS_KEY = "relay.prefs.v2";

function parseUrls(text: string): { urls: string[]; ignored: number } {
  const seen = new Set<string>();
  let ignored = 0;
  for (const tok of text.split(/\s+/).filter(Boolean)) {
    if (/^https?:\/\/\S+$/i.test(tok)) seen.add(tok);
    else ignored++;
  }
  return { urls: [...seen].slice(0, MAX_LINKS), ignored };
}

async function streamTransfer(payload: TransferRequest, signal: AbortSignal, onEvent: (e: TransferEvent) => void) {
  const r = await fetch("/api/transfer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
  if (!r.ok || !r.body) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `Request failed (${r.status})`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line) as TransferEvent);
    }
  }
}

const PHASE_TEXT: Record<string, string> = {
  connecting: "Connecting to source…",
  "creating-repo": "Creating repository…",
  "creating-folder": "Creating folder…",
  committing: "Committing to GitHub…",
  uploading: "Uploading to Google Drive…",
};

export function RelayApp() {
  const [s, setS] = useState<SessionInfo | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [header, setHeader] = useState("");
  const [showAdv, setShowAdv] = useState(false);
  const [dest, setDest] = useState<Dest>(defaultDest);
  const [info, setInfo] = useState<Record<string, InspectResult | "loading">>({});
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [running, setRunning] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const requested = useRef(new Set<string>());
  const prefsLoaded = useRef(false);

  const { urls, ignored } = useMemo(() => parseUrls(text), [text]);
  const anyLogin = !!(s?.github || s?.google);

  /* ---- session ---- */
  const loadSession = useCallback(async () => {
    try {
      const r = await fetch("/api/session", { cache: "no-store" });
      setS((await r.json()) as SessionInfo);
    } catch {
      setNotice("Could not reach the server.");
    }
  }, []);

  const loadProviders = useCallback(async () => {
    try {
      const r = await fetch("/api/providers", { cache: "no-store" });
      if (!r.ok) throw new Error("Provider list unavailable");
      const body = (await r.json()) as { providers?: ProviderInfo[] };
      setProviders(Array.isArray(body.providers) ? body.providers : []);
    } catch {
      setProviders([]);
      setNotice("Could not load the supported destinations.");
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) {
      const map: Record<string, string> = {
        google_denied: "Google sign-in was cancelled.",
        google_scope: "Google Drive permission was not granted — please allow file access.",
      };
      setNotice(map[err] ?? `Sign-in problem: ${err.replace(/_/g, " ")}.`);
      window.history.replaceState(null, "", "/");
    }
    void loadSession();
    void loadProviders();
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Dest> & { filename?: never } | null;
      if (p) setDest((d) => ({ ...d, ...p, repoMode: "existing", folderMode: "existing", newRepo: "", newFolder: "" }));
    } catch {}
    prefsLoaded.current = true;
  }, [loadProviders, loadSession]);

  useEffect(() => {
    if (!prefsLoaded.current) return;
    const { target, repo, branch, path, ifExists, folderId, isPrivate } = dest;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ target, repo, branch, path, ifExists, folderId, isPrivate }));
  }, [dest]);

  /* ---- link inspection (debounced, 3 at a time) ---- */
  useEffect(() => {
    if (!anyLogin) return;
    const keyOf = (u: string) => `${header}\u0000${u}`;
    const todo = urls.filter((u) => !requested.current.has(keyOf(u)));
    if (!todo.length) return;
    const t = setTimeout(() => {
      const queue = [...todo];
      const worker = async () => {
        for (let u = queue.shift(); u; u = queue.shift()) {
          const k = keyOf(u);
          if (requested.current.has(k)) continue;
          requested.current.add(k);
          setInfo((p) => ({ ...p, [k]: "loading" }));
          try {
            const r = await fetch("/api/inspect", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: u, header: header || undefined }),
            });
            const j = (await r.json()) as InspectResult;
            setInfo((p) => ({ ...p, [k]: j }));
          } catch {
            setInfo((p) => ({ ...p, [k]: { ok: false, error: "Could not inspect link" } }));
          }
        }
      };
      void Promise.all([worker(), worker(), worker()]);
    }, 450);
    return () => clearTimeout(t);
  }, [urls, header, anyLogin]);

  const infoFor = (u: string) => info[`${header}\u0000${u}`];

  /* ---- validation ---- */
  const connected = dest.target === "github" ? !!s?.github : !!s?.google;
  const destOk =
    dest.target === "github"
      ? dest.repoMode === "new"
        ? REPO_NAME_RE.test(dest.newRepo)
        : !!dest.repo
      : dest.folderMode === "new"
        ? dest.newFolder.trim().length > 0
        : true;
  const tooBig = dest.target === "github" && urls.some((u) => {
    const i = infoFor(u);
    return i && i !== "loading" && i.ok && i.size != null && i.size > GITHUB_MAX_BYTES;
  });
  const targetAvailable = providers.some((provider) => provider.id === dest.target);
  const canRun = targetAvailable && connected && destOk && urls.length > 0 && !running;

  /* ---- run ---- */
  const patch = useCallback((u: string, part: Partial<Run>) => setRuns((p) => {
        const base: Run = p[u] ?? { bytes: 0, total: null, speed: 0, status: "queued" };
        return { ...p, [u]: { ...base, ...part } };
      }),
    [],
  );

  async function run() {
    if (!canRun) return;
    const list = urls;
    const ac = new AbortController();
    abortRef.current = ac;
    setRunning(true);
    setRuns(Object.fromEntries(list.map((u) => [u, { status: "queued", bytes: 0, total: null, speed: 0 } as Run])));

    let repoOverride: string | undefined;
    let folderOverride: string | undefined;
    let createdRepo = false;
    let createdFolder = false;

    for (const u of list) {
      if (ac.signal.aborted) {
        patch(u, { status: "cancelled", error: "Cancelled" });
        continue;
      }
      patch(u, { status: "running", phase: "connecting" });
      const base = {
        url: u,
        header: header || undefined,
        filename: list.length === 1 && filename.trim() ? filename.trim() : undefined,
      };
      let payload: TransferRequest;
      if (dest.target === "github") {
        payload = {
          ...base,
          target: "github",
          path: dest.path || undefined,
          branch: dest.branch || undefined,
          ifExists: dest.ifExists,
          message: dest.message || undefined,
          ...(dest.repoMode === "new" && !repoOverride
            ? { newRepo: { name: dest.newRepo, private: dest.isPrivate, description: dest.newRepoDesc || undefined } }
            : { repo: repoOverride ?? dest.repo }),
        };
      } else {
        payload = {
          ...base,
          target: "drive",
          ...(dest.folderMode === "new" && !folderOverride
            ? { newFolder: dest.newFolder }
            : { folderId: folderOverride ?? (dest.folderId || undefined) }),
        };
      }

      let t0 = 0;
      let finished = false;
      try {
        await streamTransfer(payload, ac.signal, (ev) => {
          if (ev.type === "start") patch(u, { name: ev.name, total: ev.size });
          else if (ev.type === "phase") patch(u, { phase: ev.phase, kind: undefined });
          else if (ev.type === "progress") {
            const now = performance.now();
            if (!t0) t0 = now;
            const secs = Math.max(0.25, (now - t0) / 1000);
            patch(u, { kind: ev.phase, phase: ev.phase, bytes: ev.bytes, total: ev.total, speed: ev.bytes / secs });
          } else if (ev.type === "done") {
            finished = true;
            const { type: _t, ...result } = ev;
            void _t;
            patch(u, { status: "done", result, bytes: result.bytes });
            if (result.repo && dest.repoMode === "new" && !repoOverride) {
              repoOverride = result.repo;
              createdRepo = true;
            }
            if (result.folderId && dest.folderMode === "new" && !folderOverride && dest.target === "drive") {
              folderOverride = result.folderId;
              createdFolder = true;
            }
          } else if (ev.type === "error") {
            finished = true;
            patch(u, { status: ac.signal.aborted ? "cancelled" : "error", error: ev.error });
          }
        });
        if (!finished) patch(u, { status: "error", error: "Connection to the server was lost." });
      } catch (e) {
        if (ac.signal.aborted) patch(u, { status: "cancelled", error: "Cancelled" });
        else patch(u, { status: "error", error: e instanceof Error ? e.message : "Transfer failed" });
        if (e instanceof Error && /log in/i.test(e.message)) void loadSession();
      }
    }

    abortRef.current = null;
    setRunning(false);
    if (createdRepo && repoOverride) setDest((d) => ({ ...d, repoMode: "existing", repo: repoOverride!, newRepo: "", newRepoDesc: "" }));
    if (createdFolder && folderOverride) setDest((d) => ({ ...d, folderMode: "existing", folderId: folderOverride!, newFolder: "" }));
    setReloadKey((k) => k + 1);
  }

  function cancel() {
    abortRef.current?.abort();
  }

  async function copy(v: string) {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(v);
      setTimeout(() => setCopied(""), 1500);
    } catch {}
  }

  function removeUrl(u: string) {
    setText(urls.filter((x) => x !== u).join("\n"));
    setRuns((p) => {
      const { [u]: _drop, ...rest } = p;
      void _drop;
      return rest;
    });
  }

  const runList = Object.values(runs);
  const doneN = runList.filter((r) => r.status === "done").length;
  const failN = runList.filter((r) => r.status === "error").length;
  const allFinished = runList.length > 0 && !running;

  const targetName = providers.find((provider) => provider.id === dest.target)?.displayName ?? "destination";

  return (
    <div className="space-y-6">
      <Accounts s={s} onChange={loadSession} notice={notice} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {/* ---------------- Source ---------------- */}
          <section className={cx(card, "p-5")}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <span className="grid size-6 place-items-center rounded-full bg-indigo-500/20 text-xs text-indigo-300">1</span> Source links
              </h2>
              {urls.length > 0 && <span className="text-xs text-slate-500">{urls.length} link{urls.length > 1 ? "s" : ""}</span>}
            </div>

            <textarea
              className={cx(field, "resize-y font-mono text-[13px] leading-relaxed")}
              rows={Math.min(8, Math.max(3, text.split("\n").length + 1))}
              placeholder={"https://example.com/archive.zip\nPaste one link per line — up to 25 at once"}
              value={text}
              disabled={running}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void run();
                }
              }}
              spellCheck={false}
              aria-label="Download links"
            />
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                Dropbox, GitHub “blob” and Drive share links are converted to direct downloads automatically.
                {ignored > 0 && <span className="ml-1 text-amber-400">{ignored} non-URL item{ignored > 1 ? "s" : ""} ignored.</span>}
              </span>
              <kbd className="hidden rounded border border-white/10 px-1.5 py-0.5 sm:inline">Ctrl/⌘ + Enter</kbd>
            </div>

            {/* link rows */}
            {urls.length > 0 && (
              <ul className="mt-4 space-y-2">
                {urls.map((u) => {
                  const i = infoFor(u);
                  const r = runs[u];
                  const meta = i && i !== "loading" && i.ok ? i : null;
                  const name = (urls.length === 1 && filename.trim()) || r?.name || meta?.name || u.split("?")[0].split("/").filter(Boolean).pop() || u;
                  const size = r?.total ?? meta?.size ?? null;
                  const warnBig = dest.target === "github" && size != null && size > GITHUB_WARN_BYTES;
                  const hardBig = dest.target === "github" && size != null && size > GITHUB_MAX_BYTES;
                  const frac = r && r.total ? r.bytes / r.total : 0;
                  const remaining = r && r.total && r.speed > 0 ? (r.total - r.bytes) / r.speed : null;
                  return (
                    <li key={u} className="animate-fade-up rounded-xl border border-white/10 bg-slate-950/40 p-3">
                      <div className="flex items-start gap-3">
                        <div
                          className={cx(
                            "mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg",
                            r?.status === "done" ? "bg-emerald-500/15 text-emerald-300" : r?.status === "error" ? "bg-red-500/15 text-red-300" : "bg-white/5 text-slate-400",
                          )}
                        >
                          {r?.status === "done" ? <IconCheck /> : r?.status === "error" ? <IconAlert /> : r?.status === "cancelled" ? <IconBan /> : r?.status === "running" ? <Spinner /> : <IconFile />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-100" title={name}>
                              {name}
                            </span>
                            {i === "loading" && !r && <Spinner className="size-3 text-slate-500" />}
                          </div>
                          <div className="truncate text-xs text-slate-500" title={u}>
                            {meta ? `${meta.host}${size != null ? ` · ${formatBytes(size)}` : " · size unknown"} · ${meta.mime}` : i && i !== "loading" && !i.ok ? "" : u}
                          </div>
                          {i && i !== "loading" && !i.ok && !r && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-amber-400">
                              <IconAlert className="size-3.5" /> {i.error}
                            </div>
                          )}
                          {!r && hardBig && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-red-400">
                              <IconAlert className="size-3.5" /> Over GitHub’s 100 MB limit — send this one to Google Drive instead.
                            </div>
                          )}
                          {!r && warnBig && !hardBig && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-amber-400">
                              <IconAlert className="size-3.5" /> Large for GitHub (over 50 MB) — it may be slow.
                            </div>
                          )}

                          {r?.status === "running" && (
                            <div className="mt-2.5 space-y-1.5">
                              <ProgressBar value={frac} indeterminate={!r.kind || !r.total} />
                              <div className="flex flex-wrap justify-between gap-x-3 text-[11px] text-slate-400">
                                <span>
                                  {r.kind === "download"
                                    ? `Downloading from source${dest.target === "github" ? " (then commit)" : ""}`
                                    : r.kind === "upload"
                                      ? "Streaming to Google Drive"
                                      : PHASE_TEXT[r.phase ?? ""] ?? "Working…"}
                                </span>
                                {r.kind && (
                                  <span className="tabular-nums">
                                    {formatBytes(r.bytes)}
                                    {r.total ? ` / ${formatBytes(r.total)} · ${Math.round(frac * 100)}%` : ""}
                                    {r.speed > 0 && ` · ${formatBytes(r.speed)}/s`}
                                    {remaining != null && remaining < 86400 && ` · ${formatDuration(remaining * 1000)} left`}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          {r?.status === "queued" && <div className="mt-1 text-xs text-slate-500">Waiting in queue…</div>}
                          {r?.status === "error" && <div className="mt-1.5 text-xs text-red-300">{r.error}</div>}
                          {r?.status === "cancelled" && <div className="mt-1.5 text-xs text-amber-300">Cancelled</div>}
                          {r?.status === "done" && r.result && (
                            <div className="mt-2 space-y-1.5">
                              <div className="text-xs text-emerald-300">
                                {r.result.skipped ? "Already exists — skipped" : "Transferred"} · {formatBytes(r.result.bytes)} in {formatDuration(r.result.durationMs)}
                              </div>
                              <div className="truncate text-xs text-slate-400" title={r.result.location}>
                                {r.result.location}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <a href={r.result.url} target="_blank" rel="noreferrer" className={btnGhost}>
                                  <IconExternal className="size-3.5" /> Open
                                </a>
                                <button className={btnGhost} onClick={() => copy(r.result!.url)}>
                                  <IconCopy className="size-3.5" /> {copied === r.result.url ? "Copied" : "Copy link"}
                                </button>
                                <button className={cx(btnGhost, "font-mono")} onClick={() => copy(r.result!.sha256)} title="SHA-256 checksum — click to copy">
                                  <IconCopy className="size-3.5" /> {copied === r.result.sha256 ? "Copied" : `sha256 ${r.result.sha256.slice(0, 8)}…`}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                        {!running && (
                          <button className="rounded-md p-1 text-slate-500 transition hover:bg-white/10 hover:text-white" onClick={() => removeUrl(u)} aria-label="Remove link">
                            <IconX className="size-4" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* advanced */}
            <button type="button" className="mt-4 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={() => setShowAdv((v) => !v)}>
              <IconChevron className={cx("size-3.5 transition", showAdv && "rotate-180")} /> Advanced source options
            </button>
            {showAdv && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <span className={label}>Rename file {urls.length > 1 && "(single link only)"}</span>
                  <input className={cx(field, "mt-1.5")} placeholder="Auto-detected" value={filename} disabled={urls.length > 1 || running} onChange={(e) => setFilename(e.target.value)} />
                </div>
                <div>
                  <span className={label}>Request header</span>
                  <input
                    className={cx(field, "mt-1.5 font-mono text-[13px]")}
                    placeholder="Authorization: Bearer …"
                    value={header}
                    disabled={running}
                    onChange={(e) => setHeader(e.target.value)}
                    autoComplete="off"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">For private downloads. Sent only to the link’s own host, never on to redirects.</p>
                </div>
              </div>
            )}
          </section>

          {/* ---------------- Destination ---------------- */}
          <section className={cx(card, "p-5")}>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
              <span className="grid size-6 place-items-center rounded-full bg-indigo-500/20 text-xs text-indigo-300">2</span> Destination
            </h2>
            <Destination s={s} dest={dest} setDest={setDest} reloadKey={reloadKey} disabled={running} providers={providers} />

            <div className="mt-6 space-y-3">
              {tooBig && <p className="text-xs text-red-400">Some files exceed GitHub’s 100 MB limit and will fail. Remove them or switch to Google Drive.</p>}
              {running ? (
                <button className={cx(btnPrimary, "w-full !from-slate-700 !to-slate-600 !shadow-none")} onClick={cancel}>
                  <IconBan className="size-4" /> Cancel transfer
                </button>
              ) : (
                <button className={cx(btnPrimary, "w-full")} disabled={!canRun} onClick={run}>
                  <IconCloudUp className="size-4" />
                  {!targetAvailable
                    ? providersLoading ? "Loading destinations…" : "Destination unavailable"
                    : !connected
                      ? `Connect ${targetName} first`
                      : urls.length === 0
                      ? "Paste a link to begin"
                      : !destOk
                        ? "Complete the destination"
                        : `Transfer ${urls.length > 1 ? `${urls.length} files` : "file"} to ${targetName}`}
                </button>
              )}

              {allFinished && (
                <div
                  className={cx(
                    "animate-fade-up flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm",
                    failN === 0 && doneN > 0 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200",
                  )}
                  role="status"
                >
                  {failN === 0 && doneN > 0 ? <IconCheck /> : <IconAlert />}
                  {doneN} transferred{failN > 0 && ` · ${failN} failed`}
                  {runList.some((r) => r.status === "cancelled") && " · cancelled"}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6 lg:sticky lg:top-6">
          <History enabled={anyLogin} refreshKey={reloadKey} />
          <div className={cx(card, "space-y-2 p-4 text-xs leading-relaxed text-slate-400")}>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <IconLink className="size-4" /> How it works
            </h3>
            <p>The browser sends the link and options, then receives progress updates; file bytes stay on the server side and are not downloaded by the browser.</p>
            <p>If Relay runs on localhost, your computer is the server and its internet connection carries both the source download and destination upload. When hosted remotely, your device carries only the small control/progress traffic; the host’s network and bandwidth limits apply.</p>
            <p>Drive uses 8 MiB resumable chunks without writing files to disk. GitHub’s Contents API requires a base64 payload and buffers files in server memory. Each completed transfer includes a SHA-256 checksum.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
