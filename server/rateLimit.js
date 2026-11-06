// Fixed-window rate limiter keyed by client IP (or any string). In-memory and
// process-local: it protects a single self-hosted instance from a noisy client
// or a runaway script. It is NOT a billing cap — see NLP_DAILY_REQUEST_BUDGET
// for a global ceiling on paid LLM calls.

export function createRateLimiter({ max, windowMs = 60_000, now = () => Date.now() }) {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const buckets = new Map();

  function prune(t) {
    for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
  }

  return {
    /** @returns {{allowed: boolean, remaining: number, retryAfterSec: number}} */
    take(key) {
      const t = now();
      if (buckets.size > 5000) prune(t);
      let b = buckets.get(key);
      if (!b || b.resetAt <= t) { b = { count: 0, resetAt: t + windowMs }; buckets.set(key, b); }
      b.count += 1;
      const allowed = b.count <= max;
      return { allowed, remaining: Math.max(0, max - b.count), retryAfterSec: Math.ceil((b.resetAt - t) / 1000) };
    },
    size: () => buckets.size,
  };
}

/** A global daily counter (UTC day) used as an LLM spend ceiling. */
export function createDailyBudget({ limit, now = () => Date.now() }) {
  let day = null; let used = 0;
  const today = () => new Date(now()).toISOString().slice(0, 10);
  return {
    /** Reserve one unit; returns false once the day's budget is spent. limit=0 means unlimited. */
    take() {
      const d = today();
      if (d !== day) { day = d; used = 0; }
      if (limit > 0 && used >= limit) return false;
      used += 1;
      return true;
    },
    status() { const d = today(); return { day: d, used: d === day ? used : 0, limit }; },
  };
}
