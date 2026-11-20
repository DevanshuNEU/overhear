import { NextResponse } from "next/server";
import Retell from "retell-sdk";
import { env } from "@/lib/env";
import { checkWebCallLimit } from "@/lib/web-call-limit";

// Each web call mints a Retell session that burns Retell minutes plus Anthropic
// scoring credits, so the start is a spend guard for the public demo. The budget
// is shared with /api/demo-calls (see src/lib/web-call-limit.ts).

// Env access happens inside the handler, not at module top-level, so this
// route can be imported (e.g. by Next's build) without a fully-populated
// process.env, matching the lazy-Proxy contract of `@/lib/env`.
export async function POST(req: Request) {
  const rl = checkWebCallLimit(req);
  if (!rl.allowed) {
    const { retryAfter } = rl;
    return NextResponse.json(
      { error: "rate_limited", retryAfter },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  if (!env.RETELL_AGENT_ID) {
    console.warn("web-call: RETELL_AGENT_ID not configured");
    return NextResponse.json({ error: "agent not configured" }, { status: 503 });
  }
  const client = new Retell({ apiKey: env.RETELL_API_KEY });
  try {
    const call = await client.call.createWebCall({ agent_id: env.RETELL_AGENT_ID });
    // Return the full connection details, not just the token. The v3 web client
    // needs transport (gateway vs livekit), callId, and ice servers to connect;
    // with only the token it defaults to livekit and a gateway token is rejected
    // as an invalid API key.
    return NextResponse.json({
      accessToken: call.access_token,
      callId: call.call_id,
      transport: call.transport,
      iceServers: call.ice_servers,
    });
  } catch (err) {
    console.warn("web-call: createWebCall failed", err);
    return NextResponse.json({ error: "could not create web call" }, { status: 500 });
  }
}
