// The one place a Retell client is built for the product, and the only reader of the stored key.
// - The client never retries (the pull's own pool decides that), never logs (the SDK's debug log prints request
//   details), and talks to Retell's own API unless a test passes another base URL. RETELL_BASE_URL and RETELL_LOG
//   in the environment are ignored, so a stray variable cannot send the key elsewhere or print it.
// - The key goes to Retell only as the SDK's `Authorization: Bearer` header, never in a URL.
// - A client holds the key in a public field. Never log a client, return one from a route or pass one to React.
import Retell from "retell-sdk";
import type { Logger } from "retell-sdk/client";
import { isKeyShaped, readKey } from "./key-store";
import { logSafe, safeError } from "./redact";

export const RETELL_API_BASE = "https://api.retellai.com";
const TIMEOUT_MS = 15_000;

export type RetellOptions = { baseURL?: string; fetch?: typeof fetch };

const noop = () => {};
const SILENT: Logger = { error: noop, warn: noop, info: noop, debug: noop };

export function makeRetell(key: string, opts: RetellOptions = {}): Retell {
  return new Retell({
    apiKey: key,
    baseURL: opts.baseURL ?? RETELL_API_BASE,
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
