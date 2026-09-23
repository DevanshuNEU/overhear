import { NextResponse } from "next/server";
import Retell from "retell-sdk";
import { env } from "@/lib/env";

// Env access happens inside the handler, not at module top-level, so this
// route can be imported (e.g. by Next's build) without a fully-populated
// process.env, matching the lazy-Proxy contract of `@/lib/env`.
export async function POST() {
  if (!env.RETELL_AGENT_ID) {
    console.warn("web-call: RETELL_AGENT_ID not configured");
    return NextResponse.json({ error: "agent not configured" }, { status: 503 });
  }
  const client = new Retell({ apiKey: env.RETELL_API_KEY });
  try {
    const call = await client.call.createWebCall({ agent_id: env.RETELL_AGENT_ID });
    return NextResponse.json({ accessToken: call.access_token, callId: call.call_id });
  } catch (err) {
    console.warn("web-call: createWebCall failed", err);
    return NextResponse.json({ error: "could not create web call" }, { status: 500 });
  }
}
