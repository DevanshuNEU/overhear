// A tiny in-memory sliding-window rate limiter. Deliberately not backed by a
// durable store (Redis/Upstash): the reasoning lives in docs/design.md under
// "Rate limiting", but in short, Overhear runs as a single Railway instance and
// this is a soft spend guard for a demo, not a security control, so per-instance
// counters that reset on redeploy are acceptable and buy us zero extra infra.
//
// The limiter checks several rules atomically (e.g. per-IP AND global): it only
// records a hit when every rule would allow it, so a request blocked by one rule
// does not consume budget on the others.
export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimitEntry {
  key: string;
  rule: RateLimitRule;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(private now: () => number = () => Date.now()) {}

  check(entries: RateLimitEntry[]): RateLimitResult {
    const t = this.now();

    // Prune each key to only the timestamps still inside its window.
    const pruned = entries.map((e) => ({
      ...e,
      timestamps: (this.hits.get(e.key) ?? []).filter((ts) => ts > t - e.rule.windowMs),
    }));

    const blocked = pruned.filter((p) => p.timestamps.length >= p.rule.limit);
    if (blocked.length > 0) {
      // Persist the pruned windows even on a block, so stale timestamps don't
      // accumulate unbounded.
      for (const p of pruned) this.hits.set(p.key, p.timestamps);
      const retryAfterMs = Math.max(
        ...blocked.map((b) => b.timestamps[0] + b.rule.windowMs - t),
      );
      return { allowed: false, retryAfterMs };
    }

    for (const p of pruned) {
      p.timestamps.push(t);
      this.hits.set(p.key, p.timestamps);
    }
    return { allowed: true, retryAfterMs: 0 };
  }
}
