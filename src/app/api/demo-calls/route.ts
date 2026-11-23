// POST starts a call to the demo agent from the public page and answers { accessToken, callId, transport, iceServers }, the
// fields the browser needs to join and nothing else. It sets the cookie that says the call is this browser's own (the result
// route and the report page read it). Hosted only: a local copy answers 404.
//
// A start counts against the budgets once reserved and is given back when Retell did not accept the call. The owner (the
// `overhear_owner` cookie from /owner) skips the global and daily budgets.
import { createWebCall } from "@/pull/retell-source";
import { env } from "@/lib/env";
import { db } from "@/db/client";
import { ensureDemoData } from "@/demo/ensure";
import { reserveWebCall } from "@/lib/web-call-limit";
import { demoCallIds, failed, isHttps, isOwner, json, refuseLocal, sameOrigin } from "@/demo-call/http";
import { isIanaZone } from "@/lib/clinic-time";
import { setCookieHeader, signDemoCookie } from "@/demo-call/cookie";

export const dynamic = "force-dynamic";

/**
 * The caller's time zone from the body { timeZone }, or "" when the body is empty, not JSON, too large, or names no real
 * IANA zone. The agent's prompt reads it as {{caller_timezone}}; empty means it never mentions time zones. The body is
 * tiny by design (the proxy refuses large ones), so an oversized one is ignored unread.
 */
async function callerZone(req: Request): Promise<string> {
  try {
    const text = await req.text();
    if (text.length === 0 || text.length > 512) return "";
    const body: unknown = JSON.parse(text);
    const zone = typeof body === "object" && body !== null ? (body as Record<string, unknown>).timeZone : undefined;
    return isIanaZone(zone) ? zone : "";
  } catch {
    return "";
  }
}

export async function POST(req: Request): Promise<Response> {
  const local = refuseLocal();
  if (local) return local;
  if (!sameOrigin(req)) return failed("forbidden");

  const slot = reserveWebCall(req, isOwner(req));
  if (!slot.allowed) return failed("rate_limited", { retryAfter: slot.retryAfter }, { "retry-after": String(slot.retryAfter) });

  const agentId = env.RETELL_AGENT_ID;
  if (!agentId) {
    slot.refund();
    console.warn("demo-calls: RETELL_AGENT_ID not configured");
    return failed("not_configured");
  }
  try {
    // The agent books into the clinic's open slots, and they go stale by date. Topping them up is idempotent and throttled; a
    // database that is down must not stop the call from starting.
    await ensureDemoData(db).catch(() => console.warn("demo-calls: could not top up the demo clinic data"));
    const call = await createWebCall(env.RETELL_API_KEY, agentId, { dynamicVariables: { caller_timezone: await callerZone(req) } });
    // The new call is the newest; the cookie keeps the last 3 calls this browser made.
    const value = signDemoCookie([...demoCallIds(req), call.callId], env.RETELL_API_KEY);
    return json(
      { accessToken: call.accessToken, callId: call.callId, transport: call.transport, iceServers: call.iceServers },
      200,
      { "set-cookie": setCookieHeader(value, isHttps(req)) },
    );
  } catch {
    // Retell did not accept the call: no one's budget is used. Retell's own words are never logged or returned: they could quote the request.
    slot.refund();
    console.warn("demo-calls: could not create the web call");
    return failed("failed");
  }
}
