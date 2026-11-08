// GET streams what is said on a test call this server started, as Server-Sent Events: each utterance of the agent or the
// caller (id, role, content, time_sec), then `end`. The server holds the monitor socket and the key; the page gets only the
// words. One stream per call. Local mode only: a hosted copy answers 404, and a read from another site or another port is
// refused (403). An unknown call is 404. See src/pull/live-transcript.ts.
import { FRAME_HEADERS, assertLocalRequest } from "@/pull/local";
import { openLiveTranscript } from "@/pull/live-transcript";
import { failed } from "../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ callId: string }> }): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const { callId } = await params;
    const res = await openLiveTranscript(callId, request.signal);
    if (!res.ok) return failed(res.code);
    return new Response(res.body, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
        ...FRAME_HEADERS,
      },
    });
  } catch {
    return failed("failed");
  }
}
