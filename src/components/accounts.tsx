"use client";

import { useState, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import { btnGhost, card, cx, field, IconCloudUp, IconDrive, IconGithub, IconKey, IconLogout, Spinner } from "./ui";

type SessionProvider = "github" | "google" | "onedrive" | "dropbox";

function Dot({ on }: { on: boolean }) {
  return <span className={cx("inline-block size-2 rounded-full", on ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.8)]" : "bg-slate-600")} />;
}

function Setup({ lines }: { lines: string[] }) {
  return (
    <details className="group mt-3 text-xs text-slate-400">
      <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-200">How to enable OAuth login</summary>
      <ul className="mt-2 space-y-1 rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
        {lines.map((line) => <li key={line} className="break-all">{line}</li>)}
      </ul>
    </details>
  );
}

function OAuthCard({
  provider,
  label,
  account,
  configured,
  href,
  icon,
  setup,
  onLogout,
}: {
  provider: Exclude<SessionProvider, "github">;
  label: string;
  account: string | null;
  configured: boolean;
  href: string;
  icon: ReactNode;
  setup: string[];
  onLogout: (provider: SessionProvider) => void;
}) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className={cx(card, "p-4")}>
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-white/5">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">{label} <Dot on={!!account} /></div>
          <div className="truncate text-xs text-slate-400">{account ?? "Not connected"}</div>
        </div>
        {account && <button className={btnGhost} onClick={() => onLogout(provider)} title={`Disconnect ${label}`}><IconLogout className="size-3.5" /> Disconnect</button>}
      </div>
      {!account && (configured ? (
        <a href={href} className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200">
          {icon} Continue with {label.replace(" Drive", "")}
        </a>
      ) : (
        <>
          <p className="mt-3 text-xs text-slate-500">{label} login isn’t configured on this server yet.</p>
          <Setup lines={setup.map((line) => line.replace("YOUR_ORIGIN", origin))} />
        </>
      ))}
    </div>
  );
}

export function Accounts({ s, onChange, notice }: { s: SessionInfo | null; onChange: () => void; notice: string }) {
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function loginToken(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const response = await fetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pat }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) setErr(body.error ?? "Failed");
      else {
        setPat("");
        setShowPat(false);
        onChange();
      }
    } catch {
      setErr("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function logout(provider: SessionProvider) {
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (!response.ok) throw new Error("Disconnect failed");
      onChange();
    } catch {
      setErr(`Could not disconnect ${provider}. Try again.`);
    }
  }

  const gh = s?.github;
  const tokenForm = (
    <form onSubmit={loginToken} className="mt-3 space-y-2">
      <input className={field} type="password" autoComplete="off" maxLength={512} placeholder="ghp_… or github_pat_…" value={pat} onChange={(event) => setPat(event.target.value)} aria-label="GitHub personal access token" />
      <p className="text-[11px] leading-snug text-slate-500">Needs <b className="text-slate-400">repo</b> scope (classic) or Contents + Administration write (fine-grained). Stored only in an encrypted, httpOnly cookie.</p>
      <div className="flex items-center gap-2">
        <button className={btnGhost} disabled={!pat || busy}>{busy ? <Spinner className="size-3.5" /> : <IconKey className="size-3.5" />} Connect with token</button>
        {err && <span className="text-xs text-red-400" role="alert">{err}</span>}
      </div>
    </form>
  );

  return (
    <section className="grid gap-4 sm:grid-cols-2" aria-label="Accounts">
      <div className={cx(card, "p-4")}>
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-white/5 text-white">
            {gh ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`https://github.com/${gh.login}.png?size=80`} alt="" className="size-10 rounded-xl" />
            ) : <IconGithub className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">GitHub <Dot on={!!gh} /></div>
            <div className="truncate text-xs text-slate-400">{!s ? "Checking…" : gh ? `@${gh.login} · ${gh.via === "oauth" ? "OAuth" : "access token"}` : "Not connected"}</div>
          </div>
          {gh && <button className={btnGhost} onClick={() => logout("github")} title="Disconnect GitHub"><IconLogout className="size-3.5" /> Disconnect</button>}
        </div>
        {s && !gh && <>
          {s.config.githubOAuth && <a href="/api/auth/github" className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"><IconGithub /> Continue with GitHub</a>}
          {s.config.githubOAuth && !showPat ? <button className="mt-2 w-full text-center text-xs text-slate-400 hover:text-slate-200" onClick={() => setShowPat(true)}>or use a personal access token</button> : tokenForm}
          {!s.config.githubOAuth && <Setup lines={["Create an OAuth App at github.com/settings/developers", `Callback URL: ${origin}/api/auth/github/callback`, "Set env GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET"]} />}
        </>}
      </div>

      <OAuthCard provider="google" label="Google Drive" account={s?.google?.email ?? null} configured={!!s?.config.googleOAuth} href="/api/auth/google" icon={<IconDrive className="size-5" />} onLogout={logout} setup={["Create a Web OAuth client in Google Cloud Console", "Enable Google Drive API", "Redirect URI: YOUR_ORIGIN/api/auth/google/callback", "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET"]} />
      <OAuthCard provider="onedrive" label="OneDrive" account={s?.onedrive?.name ?? null} configured={!!s?.config.oneDriveOAuth} href="/api/auth/onedrive" icon={<IconCloudUp className="size-5 text-sky-300" />} onLogout={logout} setup={["Register a Microsoft Entra web application", "Add delegated User.Read and Files.ReadWrite permissions", "Redirect URI: YOUR_ORIGIN/api/auth/onedrive/callback", "Set ONEDRIVE_CLIENT_ID and ONEDRIVE_CLIENT_SECRET"]} />
      <OAuthCard provider="dropbox" label="Dropbox" account={s?.dropbox?.name ?? null} configured={!!s?.config.dropboxOAuth} href="/api/auth/dropbox" icon={<IconCloudUp className="size-5 text-blue-300" />} onLogout={logout} setup={["Create a scoped Dropbox OAuth app", "Enable account_info.read, files.content.write, and files.metadata.read", "Redirect URI: YOUR_ORIGIN/api/auth/dropbox/callback", "Set DROPBOX_CLIENT_ID and DROPBOX_CLIENT_SECRET"]} />
      {notice && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 sm:col-span-2" role="alert">{notice}</p>}
    </section>
  );
}
