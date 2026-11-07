// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createLimiter, POOL_SIZE, runPool, type PoolError } from "./pool";

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
    expect(h.sleeps).toEqual([3000, 7]);
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
    expect(h.sleeps).toEqual([1007, 7, 2007, 7, 4007, 7, 8007, 7]);
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

  it("two pools on one limiter never have more than five tasks in flight together", async () => {
    const h = harness();
    const limiter = createLimiter(POOL_SIZE);
    let live = 0;
    let peak = 0;
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => async () => {
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setImmediate(r));
        live--;
        return i;
      });
    const [a, b] = await Promise.all([runPool(make(12), { ...h.opts, limiter }), runPool(make(12), { ...h.opts, limiter })]);
    expect(peak).toBe(5);
    expect([...a, ...b].every((r) => r.ok)).toBe(true);
  });

  it("a 429 in one pool pauses the other pool on the same limiter", async () => {
    const h = harness();
    const limiter = createLimiter(POOL_SIZE);
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => (release = r));
    const slow = { ...h.opts, limiter, sleep: (ms: number) => (ms === 3000 ? hold : Promise.resolve()) };
    let hit = false;
    const a = runPool(
      [
        async () => {
          if (!hit) {
            hit = true;
            throw err({ status: 429, retryAfterMs: 3000, code: "rate_limited" });
          }
          return "a";
        },
      ],
      slow,
    );
    await new Promise((r) => setImmediate(r));
    let started = false;
    const b = runPool(
      [
        async () => {
          started = true;
          return "b";
        },
      ],
      { ...slow },
    );
    await new Promise((r) => setImmediate(r));
    expect(started).toBe(false);
    release();
    expect((await b)[0]).toEqual({ ok: true, value: "b" });
    expect((await a)[0]).toEqual({ ok: true, value: "a" });
  });

  it("a cancel wakes workers waiting in the 429 pause", async () => {
    const h = harness();
    const controller = new AbortController();
    let calls = 0;
    const tasks = Array.from({ length: 3 }, () => async () => {
      calls++;
      throw err({ status: 429, retryAfterMs: 30_000, code: "rate_limited" });
    });
    const done = runPool(tasks, { ...h.opts, size: 3, sleep: () => new Promise<void>(() => {}), signal: controller.signal, shouldStop: () => controller.signal.aborted });
    await new Promise((r) => setImmediate(r));
    controller.abort();
    const out = await done;
    expect(calls).toBe(3);
    expect(out.every((r) => !r.ok && r.error.code === "cancelled")).toBe(true);
  });

  it("workers leaving the 429 pause each wait the injected jitter", async () => {
    const h = harness();
    let first = true;
    const jitters = [11, 22];
    const tasks = Array.from({ length: 3 }, (_, i) => async () => {
      if (i === 0 && first) {
        first = false;
        throw err({ status: 429, retryAfterMs: 3000, code: "rate_limited" });
      }
      await new Promise((r) => setImmediate(r));
      return i;
    });
    let n = 0;
    await runPool(tasks, { ...h.opts, size: 3, jitter: () => jitters[n++ % 2] });
    expect(h.sleeps[0]).toBe(3000);
    expect(h.sleeps.slice(1).every((ms) => ms === 11 || ms === 22)).toBe(true);
    expect(h.sleeps.length).toBeGreaterThan(1);
  });
  it("removes each abort listener once its wait settles without a cancel", async () => {
    const h = harness();
    const controller = new AbortController();
    let added = 0;
    let removed = 0;
    const signal = controller.signal;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: AddEventListenerOptions | boolean) => {
      if (type === "abort") added++;
      add(type, fn, o);
    }) as typeof signal.addEventListener;
    signal.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: EventListenerOptions | boolean) => {
      if (type === "abort") removed++;
      remove(type, fn, o);
    }) as typeof signal.removeEventListener;
    const attempts = new Map<number, number>();
    const tasks = Array.from({ length: 4 }, (_, i) => async () => {
      const n = (attempts.get(i) ?? 0) + 1;
      attempts.set(i, n);
      if (n <= 3) throw err({ status: i % 2 === 0 ? 429 : 503, retryAfterMs: 5, code: "x" });
      return i;
    });
    const out = await runPool(tasks, { ...h.opts, size: 2, signal });
    expect(out.every((r) => r.ok)).toBe(true);
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);
  });

  it("a 401 wakes workers waiting in the 429 pause and leaves the shared pause in place", async () => {
    const h = harness();
    const limiter = createLimiter(POOL_SIZE);
    const tick = () => new Promise((r) => setImmediate(r));
    const tasks = [
      async () => {
        throw err({ status: 429, retryAfterMs: 30_000, code: "rate_limited" });
      },
      async () => {
        await tick();
        await tick();
        throw err({ status: 401, code: "bad_key" });
      },
      async () => 2,
      async () => 3,
    ];
    const done = runPool(tasks, { ...h.opts, size: 2, limiter, sleep: () => new Promise<void>(() => {}) });
    const out = await Promise.race([done, new Promise<"hung">((r) => setTimeout(() => r("hung"), 300))]);
    expect(out).not.toBe("hung");
    const results = out as Awaited<typeof done>;
    expect(results[1]).toEqual({ ok: false, error: { status: 401, code: "bad_key" } });
    expect(results.every((r) => r.ok || r.error.code === "bad_key")).toBe(true);
    expect(limiter.gate).not.toBeNull();
  });

  it("the last retry getting a 429 still applies the capped shared pause", async () => {
    const h = harness();
    const limiter = createLimiter(POOL_SIZE);
    let calls = 0;
    let pauses = 0;
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => (release = r));
    const sleep = (ms: number) => {
      h.sleeps.push(ms);
      if (ms !== 7 && ++pauses === 5) return hold;
      return Promise.resolve();
    };
    let started = false;
    const done = runPool(
      [
        async () => {
          calls++;
          throw err({ status: 429, retryAfterMs: 120_000, code: "rate_limited" });
        },
        async () => {
          started = true;
          return "next";
        },
      ],
      { ...h.opts, size: 1, limiter, sleep },
    );
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(calls).toBe(5);
    expect(limiter.gate).not.toBeNull();
    expect(started).toBe(false);
    expect(h.sleeps.filter((ms) => ms === 60_000)).toHaveLength(5);
    release();
    const out = await done;
    expect(out[0]).toEqual({ ok: false, error: { status: 429, retryAfterMs: 120_000, code: "rate_limited" } });
    expect(out[1]).toEqual({ ok: true, value: "next" });
  });
});
