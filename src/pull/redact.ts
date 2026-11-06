// Keeps the pasted Retell key out of everything Overhear prints or returns.
// - redact(text, key) takes the key, any `Bearer ...` token and anything shaped like a Retell key out of a string.
// - safeError(err) reduces any error to a class name, an HTTP status and a short code. An SDK error's message
//   holds Retell's response body, which could echo the key, so the message is never kept.
// - logSafe(event, data) is the only way src/pull writes a log line (ESLint forbids `console` there), and it
//   takes only strings, numbers and booleans, each redacted.
import { APIConnectionError, APIError } from "retell-sdk";

const REDACTED = "[redacted]";
// A bearer token, whatever its characters, up to the next space or quote.
const BEARER = /\bbearer\s+[^\s"',;]+/gi;
// Retell keys start `key_`; take the whole token after it.
const RETELL_KEY_SHAPE = /\bkey_[A-Za-z0-9_-]+/g;

export function redact(text: string, key?: string | null): string {
  let out = text;
  if (key) out = out.split(key).join(REDACTED);
  return out.replace(BEARER, `Bearer ${REDACTED}`).replace(RETELL_KEY_SHAPE, REDACTED);
}

export type SafeErrorCode = "bad_key" | "rate_limited" | "retell_down" | "network" | "unknown";
export type SafeError = { name: string; status?: number; code: SafeErrorCode };

// Class names we report. Anything else is "Error", so a name set from untrusted text never gets through.
const KNOWN_NAMES = new Set([
  "Error",
  "TypeError",
  "SyntaxError",
  "RangeError",
  "RetellError",
  "APIError",
  "APIUserAbortError",
  "APIConnectionError",
  "APIConnectionTimeoutError",
  "BadRequestError",
  "AuthenticationError",
  "PermissionDeniedError",
  "NotFoundError",
  "ConflictError",
  "UnprocessableEntityError",
  "RateLimitError",
  "InternalServerError",
]);

function className(err: unknown): string {
  if (!(err instanceof Error)) return "Error";
  const name = (err.constructor as { name?: unknown } | undefined)?.name;
  return typeof name === "string" && KNOWN_NAMES.has(name) ? name : "Error";
}

function codeFor(status: number | undefined, err: unknown): SafeErrorCode {
  if (err instanceof APIConnectionError) return "network";
  if (status === 401 || status === 403) return "bad_key";
  if (status === 429) return "rate_limited";
  if (status !== undefined && status >= 500) return "retell_down";
  return "unknown";
}

export function safeError(err: unknown): SafeError {
  const name = className(err);
  const raw = err instanceof APIError ? err.status : undefined;
  const status = typeof raw === "number" && Number.isInteger(raw) && raw >= 100 && raw <= 599 ? raw : undefined;
  const code = codeFor(status, err);
  return status === undefined ? { name, code } : { name, status, code };
}

export type LogValue = string | number | boolean;

const EVENT_SHAPE = /^[a-z0-9_.:-]{1,64}$/;
const MAX_FIELD = 200;

function cleanValue(value: unknown): LogValue | undefined {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return redact(value).slice(0, MAX_FIELD);
  return undefined;
}

/** Writes one line to stderr through console.warn: `[overhear] event {"field":value}`. */
export function logSafe(event: string, data: Record<string, LogValue> = {}): void {
  const name = EVENT_SHAPE.test(event) && redact(event) === event ? event : "event";
  const fields: Record<string, LogValue> = {};
  for (const [k, v] of Object.entries(data)) {
    const clean = cleanValue(v);
    if (clean !== undefined && EVENT_SHAPE.test(k)) fields[k] = clean;
  }
  const line = Object.keys(fields).length > 0 ? `[overhear] ${name} ${JSON.stringify(fields)}` : `[overhear] ${name}`;
  // eslint-disable-next-line no-console -- the one console call src/pull is allowed
  console.warn(line);
}
