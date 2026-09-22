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
  if (body.event === "call_analyzed") await scoreCall(body.call);
  return NextResponse.json({ ok: true });
}
