// The one place a Retell client is built for the product, and the only reader of the stored key.
// - The client never retries (the pull's own pool decides that), never logs (the SDK's debug log prints request
//   details), and talks to Retell's own API unless a test passes another base URL. RETELL_BASE_URL and RETELL_LOG
//   in the environment are ignored, so a stray variable cannot send the key elsewhere or print it.
// - The one exception is OVERHEAR_RETELL_BASE_URL, for the live canary (scripts/canary-live.ts). It counts only in
//   local mode and only when it is a plain http origin on a loopback host (see localRetellBase), so it can never
//   send the key off this computer. In local mode a value that is refused throws instead of falling back to the real
//   Retell. A hosted copy ignores it.
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

/** What a refused override says. It never quotes the value, which could hold a password. */
export const BASE_URL_REFUSED =
  "OVERHEAR_RETELL_BASE_URL must be a plain http origin on this computer, such as http://127.0.0.1:4555. Unset it to talk to Retell.";

/**
 * The base URL the live canary points the app at, or null when none is set. Honored only in local mode, and only
 * for a plain `http://` origin on a loopback host (no credentials, path, query or fragment). In local mode a value
 * that is set but refused throws, so the app never quietly talks to the real Retell when someone meant a fake. A
 * hosted copy never reads it.
 */
export function localRetellBase(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.OVERHEAR_RETELL_BASE_URL;
  if (!raw || !isLocalMode(env)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(BASE_URL_REFUSED);
  }
  const plain = url.protocol === "http:" && LOOPBACK_NAMES.has(url.hostname);
  const bare = url.username === "" && url.password === "" && url.search === "" && url.hash === "" && url.pathname === "/";
  if (!plain || !bare) throw new Error(BASE_URL_REFUSED);
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

/** Retell's ids (calls and agents) are short tokens. Anything else is not an id, and is not sent to Retell. */
export const RETELL_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** What the test call line shows of an agent. Nothing else of an agent (prompts, LLM ids, webhook URLs) is ever kept. */
export type AgentChoice = { id: string; name: string };

const MAX_AGENT_PAGES = 5;
const AGENT_PAGE = 100;
const MAX_NAME = 120;
// Controls, line and paragraph separators, zero-width and direction marks, bidi overrides and the byte order mark.
const NAME_CONTROLS = /[\u0000-\u001f\u007f-\u009f\u{200B}-\u{200F}\u{2028}-\u{202E}\u{2066}-\u{2069}\u{FEFF}]/gu;

function agentName(raw: unknown, id: string): string {
  const text = typeof raw === "string" ? raw.replace(/[\r\n]+/g, " ").replace(NAME_CONTROLS, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
  return text === "" ? id : text;
}

function byName(a: AgentChoice, b: AgentChoice): number {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  if (x !== y) return x < y ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * The user's voice agents as id and name, sorted by name, at most five pages of 100. Built field by field from each item.
 * Chat agents cannot take a web call, so they are left out. An item with no usable id is dropped.
 */
export async function listAgents(key: string, opts: RetellOptions = {}): Promise<AgentChoice[]> {
  const client = makeRetell(key, opts);
  const found = new Map<string, AgentChoice>();
  let pageKey: string | undefined;
  for (let page = 0; page < MAX_AGENT_PAGES; page++) {
    const res = await client.agent.list({ limit: AGENT_PAGE, ...(pageKey ? { pagination_key: pageKey } : {}) });
    const items: unknown[] = Array.isArray(res?.items) ? res.items : [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const r = item as Record<string, unknown>;
      const id = str(r.agent_id);
      if (id === null || !RETELL_ID.test(id) || found.has(id) || r.channel === "chat") continue;
      found.set(id, { id, name: agentName(r.agent_name, id) });
    }
    pageKey = res?.has_more === true ? (str(res.pagination_key) ?? undefined) : undefined;
    if (pageKey === undefined) break;
  }
  return [...found.values()].sort(byName);
}

export type IceServer = { urls: string | string[]; username?: string; credential?: string };
/** What the browser needs to join a web call: the same four fields the hosted demo's widget uses. */
export type WebCall = { callId: string; accessToken: string; transport: "gateway" | "livekit"; iceServers: IceServer[] };

const UNREADABLE = "unreadable web call";

function iceServer(item: unknown): IceServer {
  if (typeof item !== "object" || item === null) throw new Error(UNREADABLE);
  const r = item as Record<string, unknown>;
  const urls = typeof r.urls === "string" ? r.urls : Array.isArray(r.urls) && r.urls.every((u) => typeof u === "string") ? (r.urls as string[]) : null;
  if (urls === null) throw new Error(UNREADABLE);
  return { urls, ...(typeof r.username === "string" ? { username: r.username } : {}), ...(typeof r.credential === "string" ? { credential: r.credential } : {}) };
}

/**
 * Starts a web call to one agent and keeps only the four fields the browser needs, built field by field: the call's access
 * token is a per-call credential, and nothing else of the call is passed on. Throws an Error that says only "unreadable web
 * call" when Retell's answer does not have them; an SDK error propagates as it is, for toPoolError.
 */
export async function createWebCall(key: string, agentId: string, opts: RetellOptions = {}): Promise<WebCall> {
  const res: unknown = await makeRetell(key, opts).call.createWebCall({ agent_id: agentId });
  if (typeof res !== "object" || res === null) throw new Error(UNREADABLE);
  const r = res as Record<string, unknown>;
  const callId = str(r.call_id);
  const accessToken = str(r.access_token);
  const transport = r.transport;
  if (callId === null || !RETELL_ID.test(callId) || accessToken === null || accessToken === "") throw new Error(UNREADABLE);
  if (transport !== "gateway" && transport !== "livekit") throw new Error(UNREADABLE);
  const ice = r.ice_servers === undefined ? [] : r.ice_servers;
  if (!Array.isArray(ice)) throw new Error(UNREADABLE);
  return { callId, accessToken, transport, iceServers: ice.map(iceServer) };
}
