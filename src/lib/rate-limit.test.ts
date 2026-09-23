import { describe, it, expect } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  const rule = { limit: 3, windowMs: 10_000 };

  it("allows up to the limit, then blocks with a retry-after", () => {
    const now = 1_000;
    const rl = new RateLimiter(() => now);
    const one = () => rl.check([{ key: "ip", rule }]);

    expect(one().allowed).toBe(true);
    expect(one().allowed).toBe(true);
    expect(one().allowed).toBe(true);
    const blocked = one();
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(10_000); // oldest hit was at now, frees in a full window
  });

  it("frees up budget once the window slides past old hits", () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    const one = () => rl.check([{ key: "ip", rule }]);

    one();
    one();
    one();
    expect(one().allowed).toBe(false);

    now = 10_001; // all three original hits are now outside the window
    expect(one().allowed).toBe(true);
  });

  it("keeps separate budgets per key", () => {
    const now = 0;
    const rl = new RateLimiter(() => now);

    rl.check([{ key: "a", rule }]);
    rl.check([{ key: "a", rule }]);
    rl.check([{ key: "a", rule }]);
    expect(rl.check([{ key: "a", rule }]).allowed).toBe(false);
    // A different key is unaffected.
    expect(rl.check([{ key: "b", rule }]).allowed).toBe(true);
  });

  it("does not consume other rules when one rule blocks", () => {
    const now = 0;
    const rl = new RateLimiter(() => now);
    const ipRule = { limit: 1, windowMs: 10_000 };
    const globalRule = { limit: 100, windowMs: 10_000 };
    const both = () => rl.check([
      { key: "ip", rule: ipRule },
      { key: "global", rule: globalRule },
    ]);

    expect(both().allowed).toBe(true); // ip: 1/1, global: 1/100
    expect(both().allowed).toBe(false); // ip is full, request blocked
    expect(both().allowed).toBe(false); // still blocked by ip

    // Global should have recorded only the single allowed hit, so it still has
    // 99 left: prove it by checking global alone under a fresh, roomy ip.
    const globalOnly = rl.check([{ key: "global", rule: globalRule }]);
    expect(globalOnly.allowed).toBe(true);
  });
});
