import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter memory and refunds", () => {
  const rule = { limit: 2, windowMs: 10_000 };

  it("deletes a key once its window has no events left", () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    for (let i = 0; i < 50; i++) rl.check([{ key: `ip-${i}`, rule }]);
    expect(rl.size).toBe(50);
    now = 10_001;
    rl.check([{ key: "someone-new", rule }]);
    expect(rl.size).toBe(1);
  });

  it("gives a slot back on refund, on every key it was taken from, and drops an emptied key", () => {
    const rl = new RateLimiter(() => 5_000);
    const entries = [
      { key: "ip", rule },
      { key: "global", rule: { limit: 1, windowMs: 10_000 } },
    ];
    const first = rl.check(entries);
    expect(first.allowed).toBe(true);
    expect(rl.check(entries).allowed).toBe(false);
    rl.refund(entries, first.at!);
    expect(rl.size).toBe(0);
    expect(rl.check(entries).allowed).toBe(true);
  });

  it("refunds only the slot it took, and a second refund of it changes nothing more", () => {
    let now = 0;
    const rl = new RateLimiter(() => now);
    const entries = [{ key: "ip", rule }];
    const a = rl.check(entries);
    now = 1;
    rl.check(entries);
    rl.refund(entries, a.at!);
    rl.refund(entries, a.at!);
    expect(rl.check(entries).allowed).toBe(true);
    expect(rl.check(entries).allowed).toBe(false);
  });
});
