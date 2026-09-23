import { NextResponse } from "next/server";
import { verifyRetellSignature } from "@/retell/verify";
import { recordPendingCall, scoreCall } from "@/qa/pipeline";

// `verifyRetellSignature` is async (WebCrypto's `subtle.verify` under the
// hood) - it must be awaited here. A non-awaited Promise is always truthy
// and would bypass signature verification entirely.
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-retell-signature");
  if (!(await verifyRetellSignature(raw, signature))) {
    // Split the two failure modes so a 401 is diagnosable from the logs without
    // leaking the signature itself. "Present but invalid" almost always means
    // RETELL_API_KEY is not the webhook-badged key (Retell signs with that one
    // specific key), or the server clock has drifted past the 5-minute window.
    console.warn(
      signature
        ? "retell webhook: 401, signature present but verification failed (check RETELL_API_KEY is the webhook-badged key, and clock skew)"
        : "retell webhook: 401, no x-retell-signature header on the request",
    );
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const body = JSON.parse(raw) as { event: string; call: { call_id: string } & Record<string, unknown> };

  // Log every event we accept, so a call that never gets scored is diagnosable
  // straight from the deploy logs: call_ended but no call_analyzed means the
  // agent's analysis is not firing; neither event means the webhook is not
  // wired to this agent at all.
  console.log(`retell webhook: ${body.event} for call ${body.call?.call_id}`);

  if (body.event === "call_ended") {
    // Show the call on the dashboard as "processing" the instant the caller
    // hangs up, well before the slower call_analyzed event and scoring arrive.
    try {
      await recordPendingCall(body.call);
    } catch (err) {
      console.error(`recordPendingCall failed for call ${body.call.call_id}`, err);
    }
  }

  if (body.event === "call_analyzed") {
    try {
      await scoreCall(body.call);
    } catch (err) {
      // Acknowledge with 200 even when scoring fails, so Retell does not retry
      // the webhook in a loop on a call that will not succeed. Log with the
      // call id so the failure is diagnosable.
      console.error(`scoreCall failed for call ${body.call.call_id}`, err);
    }
  }
  return NextResponse.json({ ok: true });
}
