type Bucket = { count: number; reset: number };

const DEFAULT_MAX_BUCKETS = 5000;

/** Create a bounded LRU fixed-window limiter (also exportable for deterministic tests). */
export function createRateLimiter(maxBuckets = DEFAULT_MAX_BUCKETS) {
  if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 1) throw new Error("maxBuckets must be a positive safe integer");
  const buckets = new Map<string, Bucket>();

  return (key: string, max: number, windowMs: number): boolean => {
    if (!Number.isSafeInteger(max) || max < 1 || !Number.isFinite(windowMs) || windowMs <= 0) return false;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (bucket && bucket.reset > now) {
      // Touch active buckets so an idle key is evicted before a frequently used one.
      buckets.delete(key);
      buckets.set(key, bucket);
      bucket.count++;
      return bucket.count <= max;
    }

    if (bucket) buckets.delete(key);
    if (buckets.size >= maxBuckets) {
      for (const [candidate, value] of buckets) {
        if (value.reset <= now) buckets.delete(candidate);
      }
      while (buckets.size >= maxBuckets) {
        const oldest = buckets.keys().next().value;
        if (oldest === undefined) break;
        buckets.delete(oldest);
      }
    }

    bucket = { count: 1, reset: now + windowMs };
    buckets.set(key, bucket);
    return true;
  };
}

const processLimiter = createRateLimiter();

/** In-memory and per-process; deployments with multiple instances need an external limiter for a global quota. */
export function allow(key: string, max: number, windowMs: number): boolean {
  return processLimiter(key, max, windowMs);
}
