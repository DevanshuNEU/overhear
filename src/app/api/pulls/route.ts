// POST starts a pull of the last N calls and answers its id. The key comes from the key store, never from the
// request. Local mode only: a hosted copy answers 404, and the loopback, Host and Origin checks run here as well
// as in src/proxy.ts.
import { analyzeCall } from "@/pull/analyzer";
import { hasKey } from "@/pull/key-store";
import { assertLocalRequest, FRAME_HEADERS } from "@/pull/local";
import { startPull } from "@/pull/pull";

export const dynamic = "force-dynamic";

const DEFAULT_N = 25;
const MAX_N = 100;
const MAX_BODY = 1024;

const HEADERS = { "cache-control": "no-store", ...FRAME_HEADERS };
const json = (body: Record<string, unknown>, status: number) => Response.json(body, { status, headers: HEADERS });

/** N from a JSON body `{ "n": 25 }`: a whole number from 1 to 100. A missing body or n means 25. Null when invalid. */
async function requestedCount(request: Request): Promise<number | null> {
  const text = await request.text().catch(() => null);
  if (text === null || text.length > MAX_BODY) return null;
  if (text.trim() === "") return DEFAULT_N;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const n = (body as { n?: unknown }).n;
  if (n === undefined) return DEFAULT_N;
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= MAX_N ? n : null;
}

export async function POST(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    if (!(await hasKey())) return json({ error: "not_connected" }, 409);
    const n = await requestedCount(request);
    if (n === null) return json({ error: "bad_request" }, 400);
    return json({ id: startPull({ n, analyze: analyzeCall }) }, 202);
  } catch {
    return json({ error: "failed" }, 500);
  }
}
