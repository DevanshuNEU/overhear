import { NextResponse } from "next/server";
import { verifyRetellSignature } from "@/retell/verify";

// The demo agent's config points at this route, so it stays. It stores nothing and scores nothing: it checks the
// signature, logs the event type and call id, and answers 200.
//
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
  let event: unknown;
  let callId: unknown;
  try {
    const body = JSON.parse(raw) as { event?: unknown; call?: { call_id?: unknown } };
    event = body.event;
    callId = body.call?.call_id;
  } catch {
    // A signed body that is not JSON is still acknowledged: Retell would only retry it.
  }
  console.log(`retell webhook: ${String(event)} for call ${String(callId)}`);
  return NextResponse.json({ ok: true });
}
