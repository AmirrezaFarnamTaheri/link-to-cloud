"use client";

import { useState } from "react";
import type { SessionInfo } from "@/lib/types";
import { btnGhost, card, cx, field, IconDrive, IconGithub, IconKey, IconLogout, Spinner } from "./ui";

function Dot({ on }: { on: boolean }) {
  return <span className={cx("inline-block size-2 rounded-full", on ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.8)]" : "bg-slate-600")} />;
}

function Setup({ lines }: { lines: string[] }) {
  return (
    <details className="group mt-3 text-xs text-slate-400">
      <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-200">How to enable OAuth login</summary>
      <ul className="mt-2 space-y-1 rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
        {lines.map((l) => (
          <li key={l} className="break-all">
            {l}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Accounts({ s, onChange, notice }: { s: SessionInfo | null; onChange: () => void; notice: string }) {
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  async function loginToken(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: pat }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) setErr(j.error ?? "Failed");
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

  async function logout(provider: "github" | "google") {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider }) });
      if (!response.ok) throw new Error("Disconnect failed");
      onChange();
    } catch {
      setErr(`Could not disconnect ${provider}. Try again.`);
    }
  }

  const gh = s?.github;
  const g = s?.google;
  const tokenForm = (
    <form onSubmit={loginToken} className="mt-3 space-y-2">
      <input
        className={field}
        type="password"
        autoComplete="off"
        maxLength={512}
        placeholder="ghp_… or github_pat_…"
        value={pat}
        onChange={(e) => setPat(e.target.value)}
        aria-label="GitHub personal access token"
      />
      <p className="text-[11px] leading-snug text-slate-500">
        Needs <b className="text-slate-400">repo</b> scope (classic) or Contents + Administration write (fine-grained). Stored only in an encrypted, httpOnly cookie.
      </p>
      <div className="flex items-center gap-2">
        <button className={btnGhost} disabled={!pat || busy}>
          {busy ? <Spinner className="size-3.5" /> : <IconKey className="size-3.5" />} Connect with token
        </button>
        {err && <span className="text-xs text-red-400" role="alert">{err}</span>}
      </div>
    </form>
  );

  return (
    <section className="grid gap-4 sm:grid-cols-2" aria-label="Accounts">
      {/* GitHub */}
      <div className={cx(card, "p-4")}>
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-white/5 text-white">
            {gh ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`https://github.com/${gh.login}.png?size=80`} alt="" className="size-10 rounded-xl" />
            ) : (
              <IconGithub className="size-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              GitHub <Dot on={!!gh} />
            </div>
            <div className="truncate text-xs text-slate-400">
              {!s ? "Checking…" : gh ? `@${gh.login} · ${gh.via === "oauth" ? "OAuth" : "access token"}` : "Not connected"}
            </div>
          </div>
          {gh && (
            <button className={btnGhost} onClick={() => logout("github")} title="Disconnect GitHub">
              <IconLogout className="size-3.5" /> Disconnect
            </button>
          )}
        </div>
        {s && !gh && (
          <>
            {s.config.githubOAuth && (
              <a
                href="/api/auth/github"
                className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
              >
                <IconGithub /> Continue with GitHub
              </a>
            )}
            {s.config.githubOAuth && !showPat ? (
              <button className="mt-2 w-full text-center text-xs text-slate-400 hover:text-slate-200" onClick={() => setShowPat(true)}>
                or use a personal access token
              </button>
            ) : (
              tokenForm
            )}
            {!s.config.githubOAuth && (
              <Setup lines={["Create an OAuth App at github.com/settings/developers", `Callback URL: ${origin}/api/auth/github/callback`, "Set env GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET"]} />
            )}
          </>
        )}
      </div>

      {/* Google */}
      <div className={cx(card, "p-4")}>
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-white/5">
            <IconDrive className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              Google Drive <Dot on={!!g} />
            </div>
            <div className="truncate text-xs text-slate-400">{!s ? "Checking…" : g ? g.email : "Not connected"}</div>
          </div>
          {g && (
            <button className={btnGhost} onClick={() => logout("google")} title="Disconnect Google">
              <IconLogout className="size-3.5" /> Disconnect
            </button>
          )}
        </div>
        {s && !g && (
          <>
            {s.config.googleOAuth ? (
              <a
                href="/api/auth/google"
                className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
              >
                <IconDrive /> Continue with Google
              </a>
            ) : (
              <>
                <p className="mt-3 text-xs text-slate-500">Google login isn’t configured on this server yet.</p>
                <Setup
                  lines={[
                    "Create an OAuth client (Web) in Google Cloud Console",
                    "Enable the Google Drive API",
                    `Redirect URI: ${origin}/api/auth/google/callback`,
                    "Set env GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
                  ]}
                />
              </>
            )}
            <p className="mt-2 text-[11px] text-slate-500">Uses the narrow drive.file scope — Relay can only touch files it creates.</p>
          </>
        )}
      </div>
      {notice && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 sm:col-span-2" role="alert">
          {notice}
        </p>
      )}
    </section>
  );
}
