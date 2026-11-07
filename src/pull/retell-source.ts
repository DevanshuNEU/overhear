// The one place a Retell client is built for the product, and the only reader of the stored key.
// - The client never retries (the pull's own pool decides that), never logs (the SDK's debug log prints request
//   details), and talks to Retell's own API unless a test passes another base URL. RETELL_BASE_URL and RETELL_LOG
//   in the environment are ignored, so a stray variable cannot send the key elsewhere or print it.
// - The one exception is OVERHEAR_RETELL_BASE_URL, for the live canary (scripts/canary-live.ts). It counts only in
//   local mode and only when it is a plain http origin on a loopback host (see localRetellBase), so it can never
//   send the key off this computer, and a hosted copy ignores it.
// - The key goes to Retell only as the SDK's `Authorization: Bearer` header, never in a URL.
// - A client holds the key in a public field. Never log a client, return one from a route or pass one to React.
import Retell, { APIError } from "retell-sdk";
import type { PoolError } from "./pool";
import type { Logger } from "retell-sdk/client";
import { isKeyShaped, readKey } from "./key-store";
import { isLocalMode } from "./local";
import { logSafe, safeError } from "./redact";

export const RETELL_API_BASE = "https://api.retellai.com";
const TIMEOUT_MS = 15_000;

const LOOPBACK_NAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The base URL the live canary points the app at, or null. Honored only in local mode, and only for a plain
 * `http://` origin on a loopback host (no credentials, path, query or fragment). Anything else is ignored, so the
 * key can go only to a server on this computer.
 */
export function localRetellBase(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.OVERHEAR_RETELL_BASE_URL;
  if (!raw || !isLocalMode(env)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" || !LOOPBACK_NAMES.has(url.hostname)) return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "/") return null;
  return url.origin;
}

export type RetellOptions = { baseURL?: string; fetch?: typeof fetch };

const noop = () => {};
const SILENT: Logger = { error: noop, warn: noop, info: noop, debug: noop };

export function makeRetell(key: string, opts: RetellOptions = {}): Retell {
  return new Retell({
    apiKey: key,
    baseURL: opts.baseURL ?? localRetellBase() ?? RETELL_API_BASE,
    fetch: opts.fetch,
    maxRetries: 0,
    timeout: TIMEOUT_MS,
    logLevel: "off",
    logger: SILENT,
  });
}

/** A client for the stored key, or null when no key is stored. */
export async function storedRetell(opts: RetellOptions = {}): Promise<Retell | null> {
  const key = await readKey();
  return key === null ? null : makeRetell(key, opts);
}

export type KeyCheck = "ok" | "bad_key" | "unreachable";

/** Asks Retell for one call. Never throws, and never logs or returns Retell's answer. */
export async function checkKey(key: string, opts: RetellOptions = {}): Promise<KeyCheck> {
  if (!isKeyShaped(key)) return "bad_key";
  try {
    await makeRetell(key, opts).call.list({ limit: 1 });
    return "ok";
  } catch (err) {
    const safe = safeError(err);
    logSafe("connect.check_failed", safe.status === undefined ? { name: safe.name, code: safe.code } : { name: safe.name, status: safe.status, code: safe.code });
    return safe.code === "bad_key" ? "bad_key" : "unreachable";
  }
}

/** What the pool needs from a failed request. Built before safeError drops the status and the Retry-After header. */
export function toPoolError(err: unknown): PoolError {
  const safe = safeError(err);
  const out: PoolError = { code: safe.code };
  if (safe.status !== undefined) out.status = safe.status;
  if (err instanceof APIError) {
    const ms = parseRetryAfter(err.headers?.get?.("retry-after") ?? null);
    if (ms !== undefined) out.retryAfterMs = ms;
  }
  return out;
}

/** Retry-After as milliseconds: whole seconds, or an HTTP date. Anything else is ignored. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (/^\d{1,6}$/.test(v)) return Number(v) * 1000;
  const when = Date.parse(v);
  return Number.isNaN(when) ? undefined : Math.max(0, when - now);
}

/**
 * The few facts the pull keeps about a listed call, built field by field. A list item for a web call carries an
 * `access_token`; nothing is copied by spread, so it never enters the store or a response.
 */
export type CallMeta = {
  callId: string;
  startedAt: number;
  durationMs: number | null;
  callStatus: string;
  agentId: string | null;
  dataStorageSetting: string | null;
};

export type Listing = { calls: CallMeta[]; listed: number; skipped: number };

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function toMeta(item: unknown): CallMeta | null {
  if (typeof item !== "object" || item === null) return null;
  const r = item as Record<string, unknown>;
  const callId = str(r.call_id);
  if (callId === null) return null;
  return {
    callId,
    startedAt: num(r.start_timestamp) ?? 0,
    durationMs: num(r.duration_ms),
    callStatus: str(r.call_status) ?? "unknown",
    agentId: str(r.agent_id),
    dataStorageSetting: str(r.data_storage_setting),
  };
}

/** One list request for the last n calls, newest first. Calls that have not ended are counted as skipped. */
export async function listCalls(key: string, n: number, opts: RetellOptions = {}): Promise<Listing> {
  const res = await makeRetell(key, opts).call.list({ limit: n, sort_order: "descending" });
  const items: unknown[] = Array.isArray(res?.items) ? res.items : [];
  const metas = items.map(toMeta).filter((m): m is CallMeta => m !== null);
  const calls = metas.filter((m) => m.callStatus === "ended");
  return { calls, listed: metas.length, skipped: metas.length - calls.length };
}

/** One get-call request. The raw record goes to the analyzer and nowhere else. */
export async function getCall(key: string, id: string, opts: RetellOptions = {}): Promise<unknown> {
  return makeRetell(key, opts).call.retrieve(id);
}

/** The stored key, for the pull. Null when none is stored. */
export async function readStoredKey(): Promise<string | null> {
  return readKey();
}
