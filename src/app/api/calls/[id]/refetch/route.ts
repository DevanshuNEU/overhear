// POST fetches one call again, analyzes it and replaces its stored outcome. Answers the row, not the report.
import { assertLocalRequest, FRAME_HEADERS } from "@/pull/local";
import { retryCall } from "@/pull/pull";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  const headers = { "cache-control": "no-store", ...FRAME_HEADERS };
  try {
    const { id } = await params;
    const outcome = await retryCall(id);
    if (outcome === null) return Response.json({ error: "not_found" }, { status: 404, headers });
    return Response.json({ callId: id, state: outcome.kind }, { headers });
  } catch {
    // Same safe answer as POST /api/pulls: no message, so nothing from the key store reaches the page.
    return Response.json({ error: "failed" }, { status: 500, headers });
  }
}
