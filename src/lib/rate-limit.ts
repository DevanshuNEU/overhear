// A tiny in-memory sliding-window rate limiter. Deliberately not backed by a
// durable store (Redis/Upstash): Overhear runs as a single Railway instance and
// this is a soft spend guard for a demo, not a security control, so per-instance
// counters that reset on redeploy are acceptable and buy us zero extra infra.
//
// The limiter checks several rules atomically (e.g. per-IP AND global): it only
// records a hit when every rule would allow it, so a request blocked by one rule
// does not consume budget on the others. A hit can be given back with `refund`,
// and a key whose window has no events left is deleted, so memory follows the
// visitors still inside a window, not every address ever seen.
export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  /** When the hit was recorded (only when allowed). Hand it to `refund` to give the slot back. */
  at?: number;
}

export interface RateLimitEntry {
  key: string;
  rule: RateLimitRule;
}

const SWEEP_EVERY_MS = 1000;

export class RateLimiter {
  private hits = new Map<string, number[]>();
  // The window each key was last used with, so a sweep knows when a key has nothing left in it.
  private windows = new Map<string, number>();
  private lastSweep = Number.NEGATIVE_INFINITY;

  constructor(private now: () => number = () => Date.now()) {}

  /** How many keys are held. */
  get size(): number {
    return this.hits.size;
  }

  /** Forgets every count. */
  reset(): void {
    this.hits.clear();
    this.windows.clear();
    this.lastSweep = Number.NEGATIVE_INFINITY;
  }

  private store(key: string, timestamps: number[], windowMs: number): void {
    if (timestamps.length === 0) {
      this.hits.delete(key);
      this.windows.delete(key);
      return;
    }
    this.hits.set(key, timestamps);
    this.windows.set(key, windowMs);
  }

  /** Drops every key whose events have all left their window, at most once a second. */
  private sweep(t: number): void {
    if (t - this.lastSweep < SWEEP_EVERY_MS) return;
    this.lastSweep = t;
    for (const [key, timestamps] of this.hits) {
      const windowMs = this.windows.get(key) ?? 0;
      if (timestamps.every((ts) => ts <= t - windowMs)) this.store(key, [], windowMs);
    }
  }

  /**
   * Gives back the slot `check` took at `at` on each of these keys, because the start it counted did not happen.
   * Removes one hit made at that time, and the key itself when that was its last.
   */
  refund(entries: RateLimitEntry[], at: number): void {
    for (const e of entries) {
      const timestamps = this.hits.get(e.key);
      if (!timestamps) continue;
      const i = timestamps.indexOf(at);
      if (i !== -1) timestamps.splice(i, 1);
      this.store(e.key, timestamps, e.rule.windowMs);
    }
  }

  check(entries: RateLimitEntry[]): RateLimitResult {
    const t = this.now();
    this.sweep(t);

    // Prune each key to only the timestamps still inside its window.
    const pruned = entries.map((e) => ({
      ...e,
      timestamps: (this.hits.get(e.key) ?? []).filter((ts) => ts > t - e.rule.windowMs),
    }));

    const blocked = pruned.filter((p) => p.timestamps.length >= p.rule.limit);
    if (blocked.length > 0) {
      // Persist the pruned windows even on a block, so stale timestamps don't accumulate.
      for (const p of pruned) this.store(p.key, p.timestamps, p.rule.windowMs);
      const retryAfterMs = Math.max(
        ...blocked.map((b) => b.timestamps[0] + b.rule.windowMs - t),
      );
      return { allowed: false, retryAfterMs };
    }

    for (const p of pruned) {
      p.timestamps.push(t);
      this.store(p.key, p.timestamps, p.rule.windowMs);
    }
    return { allowed: true, retryAfterMs: 0, at: t };
  }
}
