// A bounded pool for the Retell pull: five requests at a time, backoff on 429 and 5xx, and a pause shared by every
// worker when Retell says slow down. `sleep`, `jitter` and `now` are injected so tests are exact and never wait.
import { toPoolError } from "./retell-source";

export const POOL_SIZE = 5;
const MAX_RETRIES = 4;
const BASE_WAIT_MS = 1000;
// A Retry-After longer than this is not honoured in full; the pull would look stuck.
const MAX_WAIT_MS = 60_000;

export type PoolError = { status?: number; retryAfterMs?: number; code: string };
export type PoolResult<T> = { ok: true; value: T } | { ok: false; error: PoolError };

export type PoolOptions = {
  size: number;
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
  const results: (PoolResult<T> | undefined)[] = new Array(tasks.length).fill(undefined);
  let next = 0;
  let aborted: PoolError | null = null;
  let gate: Promise<void> | null = null;
  let gateUntil = 0;

  function pause(ms: number) {
    const until = now() + ms;
    if (gate && until <= gateUntil) return;
    gateUntil = until;
    opts.onWait(until);
    const p: Promise<void> = opts.sleep(ms).then(() => {
      if (gate === p) {
        gate = null;
        opts.onWait(null);
      }
    });
    gate = p;
  }

  const finish = (i: number, r: PoolResult<T>) => {
    results[i] = r;
    opts.onResult?.(i, r);
  };

  async function runOne(i: number) {
    for (let attempt = 0; ; attempt++) {
      while (gate) await gate;
      if (aborted) return finish(i, { ok: false, error: aborted });
      if (opts.shouldStop?.()) return finish(i, { ok: false, error: { code: "cancelled" } });
      try {
        return finish(i, { ok: true, value: await tasks[i]() });
      } catch (e) {
        const error = toError(e);
        if (error.status === 401 || error.status === 403) {
          aborted = { status: error.status, code: "bad_key" };
          return finish(i, { ok: false, error: aborted });
        }
        const retryable = error.status === 429 || (error.status !== undefined && error.status >= 500);
        if (!retryable || attempt >= MAX_RETRIES) return finish(i, { ok: false, error });
        const wait = error.retryAfterMs !== undefined ? Math.min(error.retryAfterMs, MAX_WAIT_MS) : BASE_WAIT_MS * 2 ** attempt + opts.jitter();
        if (error.status === 429) pause(wait);
        else await opts.sleep(wait);
      }
    }
  }

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      await runOne(i);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.size, tasks.length)) }, worker));
  return results as PoolResult<T>[];
}
