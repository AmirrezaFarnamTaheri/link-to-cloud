"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { useCallback, useEffect, useState } from "react";
import type { HistoryItem } from "@/lib/types";
import { btnGhost, card, cx, formatBytes, formatDuration, IconAlert, IconBan, IconCheck, IconClock, IconDrive, IconExternal, IconGithub, IconTrash, timeAgo } from "./ui";

function StatusIcon({ s }: { s: HistoryItem["status"] }) {
  if (s === "success") return <IconCheck className="size-3.5 text-emerald-400" />;
  if (s === "skipped") return <IconCheck className="size-3.5 text-slate-400" />;
  if (s === "cancelled") return <IconBan className="size-3.5 text-amber-400" />;
  return <IconAlert className="size-3.5 text-red-400" />;
}

export function History({ enabled, refreshKey }: { enabled: boolean; refreshKey: number }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/history", { cache: "no-store" });
      if (!r.ok) throw new Error("History request failed");
      const j = (await r.json()) as { items?: HistoryItem[] };
      if (!Array.isArray(j.items)) throw new Error("Invalid history response");
      setItems(j.items);
      setError("");
    } catch {
      setItems([]);
      setError("Could not load transfer history. Try again later.");
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
    else {
      setItems([]);
      setError("");
    }
  }, [enabled, refreshKey, load]);

  async function clear() {
    if (!confirm("Clear your transfer history? Files already uploaded are not affected.")) return;
    try {
      const response = await fetch("/api/history", { method: "DELETE" });
      if (!response.ok) throw new Error("History clear failed");
      setItems([]);
      setError("");
    } catch {
      setError("Could not clear transfer history. Try again later.");
    }
  }

  return (
    <aside className={cx(card, "p-4")} aria-label="Transfer history" aria-busy={items === null}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <IconClock className="size-4 text-slate-400" /> Recent transfers
        </h2>
        {items && items.length > 0 && (
          <button className={btnGhost} onClick={clear}>
            <IconTrash className="size-3.5" /> Clear
          </button>
        )}
      </div>

      {error ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-3 text-sm text-red-200" role="alert">
          <p>{error}</p>
          <button className="mt-2 text-xs underline underline-offset-2" onClick={() => void load()}>Retry</button>
        </div>
      ) : items === null ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
          {enabled ? "Your finished transfers will appear here." : "Connect an account to see your history."}
        </p>
      ) : (
        <ul className="-mx-1 max-h-[34rem] space-y-1 overflow-y-auto px-1">
          {items.map((h) => (
            <li key={h.id} className="group rounded-xl px-2.5 py-2 transition hover:bg-white/5">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 text-slate-400">{h.target === "github" ? <IconGithub className="size-4" /> : <IconDrive className="size-4" />}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <StatusIcon s={h.status} />
                    <span className="truncate text-sm font-medium text-slate-100" title={h.fileName}>
                      {h.fileName}
                    </span>
                  </div>
                  <div className="truncate text-xs text-slate-500" title={h.error ?? h.location ?? h.sourceUrl}>
                    {h.status === "failed" || h.status === "cancelled" ? <span className="text-slate-400">{h.error}</span> : h.location}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-600">
                    {timeAgo(h.createdAt)}
                    {h.bytes != null && ` · ${formatBytes(h.bytes)}`}
                    {h.durationMs != null && h.status === "success" && ` · ${formatDuration(h.durationMs)}`}
                  </div>
                </div>
                {h.resultUrl && (
                  <a href={h.resultUrl} target="_blank" rel="noreferrer" className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-300" aria-label={`Open ${h.fileName}`}>
                    <IconExternal className="size-4" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
