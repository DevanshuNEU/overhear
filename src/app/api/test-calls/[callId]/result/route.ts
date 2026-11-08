// GET answers where a test call stands: { status: "processing" } until Retell has ended the call and its transcript with tool
// calls is there, then { status: "ready", outcome } (the engine's report, no_content or error), or { status: "timeout",
// message } after about two minutes of waiting. One Retell request per ask: the client asks again, the server never loops.
// Only for a call this server started. Local mode only; a read from another site or port is refused (403).
import { assertLocalRequest } from "@/pull/local";
import { testCallResult } from "@/pull/test-call";
import { failed, json } from "../../_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ callId: string }> }): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const { callId } = await params;
    const res = await testCallResult(callId);
    return res.ok ? json({ ...res.result }) : failed(res.code);
  } catch {
    return failed("failed");
  }
}
