// POST { agentId } starts a browser test call to one of the user's agents and answers { callId, accessToken, transport,
// iceServers }, the fields the browser needs to join and nothing else. The key comes from the key store, never from the
// request, and never leaves the server. One test call at a time (409 while one is starting or running). Local mode only: a
// hosted copy answers 404, and the loopback, Host and Origin checks run here as well as in src/proxy.ts.
// See src/pull/test-call.ts for the steps of a start.
import { assertLocalRequest } from "@/pull/local";
import { boundedBodyText } from "@/pull/request-body";
import { startTestCall } from "@/pull/test-call";
import { failed, json } from "./_shared";

export const dynamic = "force-dynamic";

// A start request is one agent id.
const MAX_BODY = 1024;

export async function POST(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const body = await boundedBodyText(request, MAX_BODY);
    if ("code" in body) return failed(body.code);
    let raw: unknown;
    try {
      raw = JSON.parse(body.text);
    } catch {
      return failed("bad_request");
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return failed("bad_request");
    const keys = Object.keys(raw);
    if (keys.length !== 1 || keys[0] !== "agentId") return failed("bad_request");
    const started = await startTestCall((raw as { agentId?: unknown }).agentId);
    return started.ok ? json({ ...started.call }) : failed(started.code);
  } catch {
    return failed("failed");
  }
}
