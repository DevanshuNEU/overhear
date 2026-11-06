// @vitest-environment node
import { describe, expect, it } from "vitest";
import { POOL_SIZE, runPool, type PoolError } from "./pool";

const err = (e: PoolError) => Object.assign(new Error("x"), { pool: e });
const toError = (e: unknown): PoolError => (e as { pool?: PoolError }).pool ?? { code: "unknown" };

function harness() {
  const sleeps: number[] = [];
  const waits: (number | null)[] = [];
  return {
    sleeps,
    waits,
    opts: {
      size: POOL_SIZE,
      toError,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      jitter: () => 7,
      onWait: (u: number | null) => waits.push(u),
      now: () => 1000,
    },
  };
}

describe("runPool", () => {
  it("never has more than five tasks in flight", async () => {
    const h = harness();
    let live = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, (_, i) => async () => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setImmediate(r));
      live--;
      return i;
    });
    const out = await runPool(tasks, h.opts);
    expect(peak).toBe(5);
    expect(out.every((r) => r.ok)).toBe(true);
    expect(out.map((r) => (r.ok ? r.value : -1))).toEqual(tasks.map((_, i) => i));
  });

  it("a 429 pauses every worker and honours Retry-After", async () => {
    const h = harness();
    let first = true;
    const tasks = Array.from({ length: 3 }, (_, i) => async () => {
      if (i === 0 && first) {
        first = false;
        throw err({ status: 429, retryAfterMs: 3000, code: "rate_limited" });
      }
      return i;
    });
    const out = await runPool(tasks, { ...h.opts, size: 3 });
    expect(out.every((r) => r.ok)).toBe(true);
    expect(h.sleeps).toEqual([3000]);
    expect(h.waits[0]).toBe(4000);
    expect(h.waits.at(-1)).toBeNull();
  });

  it("without Retry-After the waits are 1, 2, 4, 8 seconds with jitter", async () => {
    const h = harness();
    let calls = 0;
    const out = await runPool(
      [
        async () => {
          calls++;
          if (calls <= 4) throw err({ status: 429, code: "rate_limited" });
          return "ok";
        },
      ],
      h.opts,
    );
    expect(out[0]).toEqual({ ok: true, value: "ok" });
    expect(h.sleeps).toEqual([1007, 2007, 4007, 8007]);
  });

  it("gives up after four retries and marks that call error", async () => {
    const h = harness();
    let calls = 0;
    const out = await runPool(
      [
        async () => {
          calls++;
          throw err({ status: 503, code: "retell_down" });
        },
      ],
      h.opts,
    );
    expect(calls).toBe(5);
    expect(out[0]).toEqual({ ok: false, error: { status: 503, code: "retell_down" } });
  });

  it("one failed call leaves the others", async () => {
    const h = harness();
    const out = await runPool(
      [
        async () => 1,
        async () => {
          throw err({ status: 404, code: "unknown" });
        },
        async () => 3,
      ],
      h.opts,
    );
    expect(out.map((r) => r.ok)).toEqual([true, false, true]);
  });

  it("a 401 aborts the pool and starts nothing more", async () => {
    const h = harness();
    let ran = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      ran++;
      if (i === 0) throw err({ status: 401, code: "bad_key" });
      return i;
    });
    const out = await runPool(tasks, { ...h.opts, size: 1 });
    expect(ran).toBe(1);
    expect(out.every((r) => !r.ok && r.error.code === "bad_key")).toBe(true);
  });

  it("cancel stops new requests and keeps finished results", async () => {
    const h = harness();
    let stop = false;
    let ran = 0;
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      ran++;
      if (i === 1) stop = true;
      return i;
    });
    const out = await runPool(tasks, { ...h.opts, size: 1, shouldStop: () => stop });
    expect(ran).toBe(2);
    expect(out.slice(0, 2).every((r) => r.ok)).toBe(true);
    expect(out.slice(2).every((r) => !r.ok && r.error.code === "cancelled")).toBe(true);
  });

  it("reports each result as it finishes", async () => {
    const h = harness();
    const seen: number[] = [];
    await runPool([async () => 1, async () => 2], { ...h.opts, onResult: (i) => seen.push(i) });
    expect(seen.sort()).toEqual([0, 1]);
  });
});
