import { NextResponse } from "next/server";
import { verifyRetellSignature } from "@/retell/verify";
import { scoreCall } from "@/qa/pipeline";

// `verifyRetellSignature` is async (WebCrypto's `subtle.verify` under the
// hood) - it must be awaited here. A non-awaited Promise is always truthy
// and would bypass signature verification entirely.
export async function POST(req: Request) {
  const raw = await req.text();
  if (!(await verifyRetellSignature(raw, req.headers.get("x-retell-signature")))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const body = JSON.parse(raw) as { event: string; call: { call_id: string } & Record<string, unknown> };
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
