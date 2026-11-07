// A bounded pool for the Retell pull: five requests at a time, backoff on 429 and 5xx, and a pause shared by every
// worker when Retell says slow down. The five slots and the pause live in a Limiter, so every pool that shares one
// (a pull and a refetch) stays under five requests in flight together and obeys one pause. `sleep`, `jitter` and
// `now` are injected so tests are exact and never wait.
import { toPoolError } from "./retell-source";

export const POOL_SIZE = 5;
const MAX_RETRIES = 4;
const BASE_WAIT_MS = 1000;
// A Retry-After longer than this is not honoured in full; the pull would look stuck.
const MAX_WAIT_MS = 60_000;

export type PoolError = { status?: number; retryAfterMs?: number; code: string };
export type PoolResult<T> = { ok: true; value: T } | { ok: false; error: PoolError };

/** The shared state behind the limit: slots in use, the queue for a slot, and the 429 pause. */
export type Limiter = {
  size: number;
  inflight: number;
  queue: (() => void)[];
  gate: Promise<void> | null;
  gateUntil: number;
  listeners: Set<(untilMs: number | null) => void>;
};

export function createLimiter(size: number = POOL_SIZE): Limiter {
  return { size, inflight: 0, queue: [], gate: null, gateUntil: 0, listeners: new Set() };
}

const acquire = (l: Limiter): Promise<void> => {
  if (l.inflight < l.size) {
    l.inflight++;
    return Promise.resolve();
  }
  // The slot is handed over by release, so inflight stays the same.
  return new Promise<void>((resolve) => l.queue.push(resolve));
};

const release = (l: Limiter) => {
  const next = l.queue.shift();
  if (next) next();
  else l.inflight--;
};

export type PoolOptions = {
  size: number;
  /** Slots and pause shared with other pools. Without it the pool has its own, of `size`. */
  limiter?: Limiter;
  /** Aborting wakes workers that wait in a pause, so a cancel shows at once. */
  signal?: AbortSignal;
  /** Called with the time (ms since epoch) the pool resumes, and with null when it has resumed. */
  onWait(untilMs: number | null): void;
  sleep(ms: number): Promise<void>;
  jitter(): number;
  now?: () => number;
  toError?: (err: unknown) => PoolError;
  /** True once the caller cancelled: no new request starts, finished results are kept. */
  shouldStop?: () => boolean;
  onResult?: (index: number, result: PoolResult<unknown>) => void;
};

export async function runPool<T>(tasks: (() => Promise<T>)[], opts: PoolOptions): Promise<PoolResult<T>[]> {
  const now = opts.now ?? Date.now;
  const toError = opts.toError ?? toPoolError;
  const limiter = opts.limiter ?? createLimiter(opts.size);
  const results: (PoolResult<T> | undefined)[] = new Array(tasks.length).fill(undefined);
  let next = 0;
  let aborted: PoolError | null = null;

  const stopped = () => opts.shouldStop?.() === true || opts.signal?.aborted === true;

  /** Wakes the workers of this pool that wait in a pause or a backoff, when the key is rejected. */
  const wakers = new Set<() => void>();

  /** Resolves when `p` does, or at once when the signal aborts or the key is rejected. Its listeners go when it settles. */
  function untilCancelled(p: Promise<unknown>): Promise<unknown> {
    const signal = opts.signal;
    if (signal?.aborted || aborted) return Promise.resolve();
    let off = () => {};
    const interrupted = new Promise<void>((resolve) => {
      const wake = () => resolve();
      wakers.add(wake);
      signal?.addEventListener("abort", wake, { once: true });
      off = () => {
        wakers.delete(wake);
        signal?.removeEventListener("abort", wake);
      };
    });
    return Promise.race([p, interrupted]).finally(off);
  }

  const notify = (until: number | null) => limiter.listeners.forEach((fn) => fn(until));

  function pause(ms: number) {
    const until = now() + ms;
    if (limiter.gate && until <= limiter.gateUntil) return;
    limiter.gateUntil = until;
    notify(until);
    const p: Promise<void> = opts.sleep(ms).then(() => {
      if (limiter.gate === p) {
        limiter.gate = null;
        notify(null);
      }
    });
    limiter.gate = p;
  }

  const finish = (i: number, r: PoolResult<T>) => {
    results[i] = r;
    opts.onResult?.(i, r);
  };

  /** Waits out the pause, then takes a slot. False when the pool was cancelled while waiting; true holds a slot. */
  async function enter(): Promise<boolean> {
    for (;;) {
      let waited = false;
      while (limiter.gate) {
        waited = true;
        await untilCancelled(limiter.gate);
        if (stopped() || aborted) return false;
      }
      // Workers leaving the pause together would hit Retell together again: spread them out.
      if (waited) {
        const j = opts.jitter();
        if (j > 0) await untilCancelled(opts.sleep(j));
        if (stopped() || aborted) return false;
      }
      await acquire(limiter);
      if (!limiter.gate) return true;
      release(limiter);
    }
  }

  async function runOne(i: number) {
    for (let attempt = 0; ; attempt++) {
      const held = await enter();
      if (aborted) {
        if (held) release(limiter);
        return finish(i, { ok: false, error: aborted });
      }
      if (!held || stopped()) {
        if (held) release(limiter);
        return finish(i, { ok: false, error: { code: "cancelled" } });
      }
      let value: T;
      try {
        value = await tasks[i]();
      } catch (e) {
        release(limiter);
        const error = toError(e);
        if (error.status === 401 || error.status === 403) {
          aborted = { status: error.status, code: "bad_key" };
          // Workers waiting in a pause end now. The pause itself stays, other users of the limiter still obey it.
          wakers.forEach((wake) => wake());
          return finish(i, { ok: false, error: aborted });
        }
        const retryable = error.status === 429 || (error.status !== undefined && error.status >= 500);
        if (!retryable) return finish(i, { ok: false, error });
        const wait = Math.min(error.retryAfterMs ?? BASE_WAIT_MS * 2 ** attempt + opts.jitter(), MAX_WAIT_MS);
        // A 429 pauses everyone, also when this was the last try: queued calls must not start during the cooldown.
        if (error.status === 429) pause(wait);
        if (attempt >= MAX_RETRIES) return finish(i, { ok: false, error });
        if (error.status !== 429) await untilCancelled(opts.sleep(wait));
        continue;
      }
      release(limiter);
      return finish(i, { ok: true, value });
    }
  }

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      await runOne(i);
    }
  }

  limiter.listeners.add(opts.onWait);
  if (limiter.gate) opts.onWait(limiter.gateUntil);
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.size, tasks.length)) }, worker));
  } finally {
    limiter.listeners.delete(opts.onWait);
  }
  return results as PoolResult<T>[];
}
