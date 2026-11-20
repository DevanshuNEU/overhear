// POST starts a call to the demo agent from the public page and answers { accessToken, callId, transport, iceServers }, the
// fields the browser needs to join and nothing else. It sets the cookie that says the call is this browser's own (the result
// route and the report page read it). Hosted only: a local copy answers 404. The spend guard is shared with /api/web-call.
import { createWebCall } from "@/pull/retell-source";
import { env } from "@/lib/env";
import { checkWebCallLimit } from "@/lib/web-call-limit";
import { demoCallIds, failed, json, refuseLocal, sameOrigin } from "@/demo-call/http";
import { setCookieHeader, signDemoCookie } from "@/demo-call/cookie";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const local = refuseLocal();
  if (local) return local;
  if (!sameOrigin(req)) return failed("forbidden");

  const limit = checkWebCallLimit(req);
  if (!limit.allowed) return failed("rate_limited", { retryAfter: limit.retryAfter }, { "retry-after": String(limit.retryAfter) });

  const agentId = env.RETELL_AGENT_ID;
  if (!agentId) {
    console.warn("demo-calls: RETELL_AGENT_ID not configured");
    return failed("not_configured");
  }
  try {
    const call = await createWebCall(env.RETELL_API_KEY, agentId);
    // The new call is the newest; the cookie keeps the last 3 calls this browser made.
    const value = signDemoCookie([...demoCallIds(req), call.callId], env.RETELL_API_KEY);
    const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
    return json(
      { accessToken: call.accessToken, callId: call.callId, transport: call.transport, iceServers: call.iceServers },
      200,
      { "set-cookie": setCookieHeader(value, secure) },
    );
  } catch {
    // Retell's own words are never logged or returned: they could quote the request.
    console.warn("demo-calls: could not create the web call");
    return failed("failed");
  }
}
