"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/* ----------------------------------------------------------------- tokens */
export const card = "rounded-2xl border border-white/10 bg-slate-900/60 shadow-xl shadow-black/20 backdrop-blur";
export const field =
  "w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-indigo-400/60 focus:ring-4 focus:ring-indigo-400/10 disabled:cursor-not-allowed disabled:opacity-50";
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:brightness-110 active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:hover:brightness-100";
export const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50";
export const label = "text-[11px] font-semibold uppercase tracking-wider text-slate-400";

/* ---------------------------------------------------------------- helpers */
export function formatBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(v >= 10 ? 1 : 2)} ${u[i]}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

/* ------------------------------------------------------------------ icons */
type P = { className?: string };
const stroke = (d: ReactNode) =>
  function Icon({ className = "size-4" }: P) {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {d}
      </svg>
    );
  };

export const IconCheck = stroke(<path d="M20 6 9 17l-5-5" />);
export const IconX = stroke(<path d="M18 6 6 18M6 6l12 12" />);
export const IconAlert = stroke(
  <>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
  </>,
);
export const IconCopy = stroke(
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
);
export const IconExternal = stroke(<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />);
export const IconTrash = stroke(<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />);
export const IconChevron = stroke(<path d="m6 9 6 6 6-6" />);
export const IconFolder = stroke(<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9L9.6 3.9A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z" />);
export const IconLock = stroke(
  <>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>,
);
export const IconFile = stroke(
  <>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" />
    <path d="M14 2v6h6" />
  </>,
);
export const IconClock = stroke(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </>,
);
export const IconKey = stroke(
  <>
    <circle cx="7.5" cy="15.5" r="5.5" />
    <path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3" />
  </>,
);
export const IconLogout = stroke(<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />);
export const IconPlus = stroke(<path d="M12 5v14M5 12h14" />);
export const IconLink = stroke(
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </>,
);
export const IconCloudUp = stroke(
  <>
    <path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2" />
    <path d="M12 12v9M8 16l4-4 4 4" />
  </>,
);
export const IconBan = stroke(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="m4.9 4.9 14.2 14.2" />
  </>,
);

export function IconGithub({ className = "size-4" }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}

export function IconDrive({ className = "size-4" }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#34A853" d="M8.5 3 2 14.3l3.5 6L12 9z" />
      <path fill="#FBBC04" d="M8.5 3h7L22 14.3h-7z" />
      <path fill="#4285F4" d="M5.5 20.3 9 14.3h13l-3.5 6z" />
    </svg>
  );
}

export function Spinner({ className = "size-4" }: P) {
  return (
    <svg viewBox="0 0 24 24" className={cx(className, "animate-spin")} fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------------------------------------- progress */
export function ProgressBar({
  value,
  indeterminate,
  ariaLabel = "Transfer progress",
}: {
  value?: number;
  indeterminate?: boolean;
  ariaLabel?: string;
}) {
  const percent = Math.min(100, Math.max(0, Number.isFinite(value) ? (value ?? 0) * 100 : 0));
  return (
    <div
      className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10"
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(percent)}
    >
      {indeterminate ? (
        <div className="animate-indeterminate absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400" />
      ) : (
        <div
          className="progress-stripes h-full rounded-full bg-gradient-to-r from-indigo-500 to-cyan-400 transition-[width] duration-200"
          style={{ width: `${Math.min(100, Math.max(2, percent))}%` }}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- segments */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  disabled?: boolean;
  ariaLabel: string;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + options.length - 1) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else return;

    event.preventDefault();
    if (options.length === 0 || disabled) return;
    onChange(options[next].value);
    buttons.current[next]?.focus();
  }

  return (
    <div
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-white/10 bg-slate-950/50 p-1"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((option, index) => (
        <button
          ref={(element) => { buttons.current[index] = element; }}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={selectedIndex === index || (selectedIndex < 0 && index === 0) ? 0 : -1}
          key={option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className={cx(
            "flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:opacity-50",
            value === option.value ? "bg-white/10 text-white shadow-inner shadow-white/5" : "text-slate-400 hover:text-slate-200",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm text-slate-300">
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden="true"
        className={cx(
          "relative h-5 w-9 rounded-full transition peer-focus-visible:ring-4 peer-focus-visible:ring-indigo-400/50",
          checked ? "bg-indigo-500" : "bg-white/15",
        )}
      >
        <span className={cx("absolute top-0.5 size-4 rounded-full bg-white transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
      {children}
    </label>
  );
}
