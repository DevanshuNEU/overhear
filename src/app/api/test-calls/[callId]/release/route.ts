// POST frees the one-call slot for a test call this server started and that never connected: the browser calls it when the SDK
// fails to join or the person leaves before the call starts. It makes no Retell request and answers { released }, true when a
// slot was held by that call. Only for a call this server started. Local mode only: a hosted copy answers 404, and the loopback,
// Host and Origin checks run here as well as in src/proxy.ts. There is no GET.
import { assertLocalRequest } from "@/pull/local";
import { releaseTestCall } from "@/pull/test-call";
import { failed, json } from "../../_shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ callId: string }> }): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const { callId } = await params;
    const res = releaseTestCall(callId);
    return res.ok ? json({ released: res.released }) : failed(res.code);
  } catch {
    return failed("failed");
  }
}
