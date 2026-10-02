import type { TransferTarget } from "@/lib/types";

const LIMITS: Record<TransferTarget, number> = {
  github: 1,
  drive: 2,
};

const active: Record<TransferTarget, number> = {
  github: 0,
  drive: 0,
};

/** Acquire a per-process capacity slot; release is idempotent. */
export function acquireTransferSlot(target: TransferTarget): (() => void) | null {
  if (active[target] >= LIMITS[target]) return null;
  active[target]++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active[target] = Math.max(0, active[target] - 1);
  };
}
