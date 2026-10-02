"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from "react";
import type { DriveFolder, ProviderInfo, Repo, SessionInfo } from "@/lib/types";
import { cx, field, IconDrive, IconGithub, IconChevron, label, Segmented, Toggle } from "./ui";

export type Dest = {
  target: "github" | "drive";
  repoMode: "existing" | "new";
  repo: string;
  newRepo: string;
  newRepoDesc: string;
  isPrivate: boolean;
  branch: string;
  path: string;
  ifExists: "overwrite" | "rename" | "skip";
  message: string;
  folderId: string;
  newFolder: string;
  folderMode: "existing" | "new";
};

export const defaultDest: Dest = {
  target: "github",
  repoMode: "existing",
  repo: "",
  newRepo: "",
  newRepoDesc: "",
  isPrivate: true,
  branch: "",
  path: "",
  ifExists: "rename",
  message: "",
  folderId: "",
  newFolder: "",
  folderMode: "existing",
};

export const REPO_NAME_RE = /^[\w.-]{1,100}$/;

export function Destination({
  s,
  dest,
  setDest,
  reloadKey,
  disabled,
  providers,
}: {
  s: SessionInfo | null;
  dest: Dest;
  setDest: React.Dispatch<React.SetStateAction<Dest>>;
  reloadKey: number;
  disabled: boolean;
  providers: ProviderInfo[];
}) {
  const set = (p: Partial<Dest>) => setDest((d) => ({ ...d, ...p }));
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [showAdv, setShowAdv] = useState(false);

  const ghLogin = s?.github?.login;
  const gEmail = s?.google?.email;

  useEffect(() => {
    if (!ghLogin) {
      setRepos([]);
      return;
    }
    let live = true;
    setReposLoading(true);
    fetch("/api/github/repos")
      .then((r) => (r.ok ? r.json() : { repos: [] }))
      .then((j: { repos: Repo[] }) => {
        if (!live) return;
        setRepos(j.repos);
        setDest((d) => (d.repo && j.repos.some((r) => r.name === d.repo) ? d : { ...d, repo: j.repos[0]?.name ?? "" }));
      })
      .catch(() => {})
      .finally(() => live && setReposLoading(false));
    return () => {
      live = false;
    };
  }, [ghLogin, reloadKey, setDest]);

  useEffect(() => {
    if (!ghLogin || dest.target !== "github" || dest.repoMode !== "existing" || !dest.repo) {
      setBranches([]);
      return;
    }
    let live = true;
    fetch(`/api/github/branches?repo=${encodeURIComponent(dest.repo)}`)
      .then((r) => (r.ok ? r.json() : { branches: [] }))
      .then((j: { branches: string[] }) => {
        if (!live) return;
        setBranches(j.branches);
        setDest((d) => (d.branch && !j.branches.includes(d.branch) ? { ...d, branch: "" } : d));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ghLogin, dest.target, dest.repoMode, dest.repo, setDest]);

  useEffect(() => {
    if (!gEmail || dest.target !== "drive") return;
    let live = true;
    fetch("/api/drive/folders")
      .then((r) => (r.ok ? r.json() : { folders: [] }))
      .then((j: { folders: DriveFolder[] }) => {
        if (!live) return;
        setFolders(j.folders);
        setDest((d) => (d.folderId && !j.folders.some((f) => f.id === d.folderId) ? { ...d, folderId: "" } : d));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [gEmail, dest.target, reloadKey, setDest]);

  const shown = filter ? repos.filter((r) => r.name.toLowerCase().includes(filter.toLowerCase())) : repos;
  const current = repos.find((r) => r.name === dest.repo);
  const nameBad = dest.repoMode === "new" && dest.newRepo !== "" && !REPO_NAME_RE.test(dest.newRepo);

  return (
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
      {providers.length > 0 ? (
        <Segmented
          value={dest.target}
          onChange={(target) => set({ target })}
          options={providers.map((provider) => {
            const connected = provider.id === "github" ? !!s?.github : !!s?.google;
            const Icon = provider.icon === "github" ? IconGithub : IconDrive;
            return {
              value: provider.id,
              label: (
                <>
                  <Icon className="size-4" /> {provider.displayName}{" "}
                  {connected && <span className="size-1.5 rounded-full bg-emerald-400" />}
                </>
              ),
            };
          })}
        />
      ) : (
        <p role="status" className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          No destinations are available. Reload the app after checking the server.
        </p>
      )}

      {dest.target === "github" ? (
        <div className="space-y-4">
          <Segmented
            value={dest.repoMode}
            onChange={(repoMode) => set({ repoMode })}
            options={[
              { value: "existing", label: "Existing repository" },
              { value: "new", label: "Create new repository" },
            ]}
          />

          {dest.repoMode === "existing" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className={label}>Repository</span>
                {current && <span className="text-[11px] text-slate-500">{current.private ? "Private" : "Public"} · default branch {current.defaultBranch}</span>}
              </div>
              {repos.length > 8 && (
                <input className={field} placeholder="Filter repositories…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              )}
              <div className="relative">
                <select className={cx(field, "appearance-none pr-9")} value={dest.repo} onChange={(e) => set({ repo: e.target.value })} aria-label="Repository">
                  {!ghLogin && <option value="">Connect GitHub to choose a repo</option>}
                  {ghLogin && reposLoading && repos.length === 0 && <option value="">Loading repositories…</option>}
                  {ghLogin && !reposLoading && repos.length === 0 && <option value="">No writable repositories</option>}
                  {shown.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.private ? "🔒 " : ""}
                      {r.name}
                    </option>
                  ))}
                </select>
                <IconChevron className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <span className={label}>Repository name</span>
                <input
                  className={cx(field, "mt-1.5", nameBad && "border-red-500/60")}
                  placeholder="my-new-repo"
                  value={dest.newRepo}
                  onChange={(e) => set({ newRepo: e.target.value.replace(/\s+/g, "-") })}
                  aria-invalid={nameBad}
                />
                {nameBad && <p className="mt-1 text-xs text-red-400">Letters, numbers, “-”, “_” and “.” only.</p>}
                {ghLogin && <p className="mt-1 text-[11px] text-slate-500">Will be created at github.com/{ghLogin}/{dest.newRepo || "…"}</p>}
              </div>
              <input className={field} placeholder="Description (optional)" value={dest.newRepoDesc} onChange={(e) => set({ newRepoDesc: e.target.value })} />
              <Toggle checked={dest.isPrivate} onChange={(isPrivate) => set({ isPrivate })}>
                Private repository
              </Toggle>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className={label}>Folder in repo</span>
              <input className={cx(field, "mt-1.5")} placeholder="(root) e.g. assets/files" value={dest.path} onChange={(e) => set({ path: e.target.value })} />
            </div>
            <div>
              <span className={label}>Branch</span>
              <div className="relative mt-1.5">
                <select
                  className={cx(field, "appearance-none pr-9")}
                  value={dest.branch}
                  disabled={dest.repoMode === "new" || branches.length === 0}
                  onChange={(e) => set({ branch: e.target.value })}
                  aria-label="Branch"
                >
                  <option value="">Default{current ? ` (${current.defaultBranch})` : ""}</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <IconChevron className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              </div>
            </div>
          </div>

          <div>
            <span className={label}>If the file already exists</span>
            <div className="mt-1.5">
              <Segmented
                value={dest.ifExists}
                onChange={(ifExists) => set({ ifExists })}
                options={[
                  { value: "rename", label: "Keep both" },
                  { value: "overwrite", label: "Overwrite" },
                  { value: "skip", label: "Skip" },
                ]}
              />
            </div>
          </div>

          <button type="button" className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200" onClick={() => setShowAdv((v) => !v)}>
            <IconChevron className={cx("size-3.5 transition", showAdv && "rotate-180")} /> Commit options
          </button>
          {showAdv && (
            <input className={field} placeholder="Commit message (default: Add <file>)" value={dest.message} onChange={(e) => set({ message: e.target.value })} maxLength={200} />
          )}
          <p className="text-[11px] text-slate-500">GitHub rejects files over 100 MiB. Its Contents API requires a base64 JSON payload, so Relay buffers each file in server memory and uses extra memory while encoding; avoid large or concurrent GitHub transfers.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Segmented
            value={dest.folderMode}
            onChange={(folderMode) => set({ folderMode })}
            options={[
              { value: "existing", label: "Existing folder" },
              { value: "new", label: "Create new folder" },
            ]}
          />
          {dest.folderMode === "existing" ? (
            <div>
              <span className={label}>Folder</span>
              <div className="relative mt-1.5">
                <select className={cx(field, "appearance-none pr-9")} value={dest.folderId} onChange={(e) => set({ folderId: e.target.value })} aria-label="Drive folder">
                  <option value="">My Drive (root)</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      📁 {f.name}
                    </option>
                  ))}
                </select>
                <IconChevron className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">Because Relay only has the narrow drive.file scope, this lists folders Relay created. Create one once, reuse it forever.</p>
            </div>
          ) : (
            <div>
              <span className={label}>New folder name</span>
              <input className={cx(field, "mt-1.5")} placeholder="Relay uploads" value={dest.newFolder} onChange={(e) => set({ newFolder: e.target.value })} />
            </div>
          )}
          <p className="text-[11px] text-slate-500">Uploads use Drive resumable chunks of up to 8 MiB, including sources with unknown size. Relay writes no file to disk and holds at most one application chunk per active Drive transfer; server and provider limits still apply.</p>
        </div>
      )}
    </fieldset>
  );
}
