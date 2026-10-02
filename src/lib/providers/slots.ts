const LIMITS: Record<string, number> = {
  github: 1,
  drive: 2,
  onedrive: 2,
  dropbox: 2,
};

const active = new Map<string, number>();

/** Acquire a bounded per-process capacity slot; release is idempotent. */
export function acquireTransferSlot(target: string): (() => void) | null {
  const limit = LIMITS[target] ?? 1;
  const count = active.get(target) ?? 0;
  if (count >= limit) return null;
  active.set(target, count + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active.set(target, Math.max(0, (active.get(target) ?? 1) - 1));
  };
}
