// The pasted Retell key: POST checks it against Retell and stores it on this computer, DELETE removes it, GET
// says whether one is stored. No answer ever holds the key, any part of it, or anything Retell said.
// Local mode only: on a hosted copy every method answers 404 (src/proxy.ts says so too). The key comes only
// from the JSON body, never from the URL or a cookie.
import { clearPulls } from "@/pull/pull";
import { checkKey } from "@/pull/retell-source";
import { hasKey, KeyStoreError, removeKey, writeKey } from "@/pull/key-store";
import { assertLocalRequest, FRAME_HEADERS } from "@/pull/local";
import { CONNECT_MESSAGE, LOCAL_REFUSAL, type ConnectError } from "@/pull/labels";
import { logSafe, safeError } from "@/pull/redact";

export const dynamic = "force-dynamic";

// A Retell key is a few dozen characters; anything near this is not a key.
const MAX_BODY = 4096;

const NO_STORE = { "cache-control": "no-store", ...FRAME_HEADERS };

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function failed(error: ConnectError, status: number): Response {
  return json({ connected: false, error, message: CONNECT_MESSAGE[error] }, status);
}

function plain(text: string, status: number): Response {
  return new Response(text, { status, headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } });
}

/** The answer for a key store failure: the store's own refusal when it made one, else a plain failure. */
function storeError(err: unknown): ConnectError {
  return err instanceof KeyStoreError ? err.code : "store_failed";
}

function logFailure(event: string, err: unknown) {
  const safe = safeError(err);
  logSafe(event, safe.status === undefined ? { name: safe.name, code: safe.code } : { name: safe.name, status: safe.status, code: safe.code });
}

export async function GET(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    return json({ connected: await hasKey() });
  } catch (err) {
    logFailure("connect.read_failed", err);
    return failed(storeError(err), 500);
  }
}

/** The pasted key from the JSON body, trimmed, or null when the body is not `{ "key": "<text>" }`. */
async function pastedKey(request: Request): Promise<{ key: string } | { refused: Response }> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) return { refused: plain(LOCAL_REFUSAL.unsupported, 415) };
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY) return { refused: plain(LOCAL_REFUSAL.tooLarge, 413) };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { refused: failed("bad_request", 400) };
  }
  if (text.length > MAX_BODY) return { refused: plain(LOCAL_REFUSAL.tooLarge, 413) };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // The parser's message quotes the body, which holds the key. Never log or return it.
    return { refused: failed("bad_request", 400) };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { refused: failed("bad_request", 400) };
  const raw = (body as { key?: unknown }).key;
  if (typeof raw !== "string" || raw.trim() === "") return { refused: failed("bad_request", 400) };
  return { key: raw.trim() };
}

export async function POST(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const pasted = await pastedKey(request);
    if ("refused" in pasted) return pasted.refused;

    const check = await checkKey(pasted.key);
    if (check === "bad_key") return failed("bad_key", 422);
    if (check === "unreachable") return failed("unreachable", 502);

    try {
      await writeKey(pasted.key);
    } catch (err) {
      logFailure("connect.store_failed", err);
      return failed(storeError(err), 500);
    }
    // A new key may be another account's. Pulls, calls and remembered misses from the old key go, as in Disconnect.
    // After the write, so a fetch that read the old key and is still running cannot store its answer.
    clearPulls();
    return json({ connected: true });
  } catch (err) {
    logFailure("connect.failed", err);
    return failed("unreachable", 500);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    // A running pull holds the key in memory, and the pulls hold what it read. Stop and drop them first, so
    // disconnecting leaves nothing that can still reach Retell or show the account's calls.
    clearPulls();
    await removeKey();
    return json({ connected: false });
  } catch (err) {
    logFailure("connect.remove_failed", err);
    return failed("store_failed", 500);
  }
}
