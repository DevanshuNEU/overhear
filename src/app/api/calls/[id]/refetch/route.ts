// POST fetches one call again, analyzes it and replaces its stored outcome. Answers the row, not the report.
import { assertLocalRequest, FRAME_HEADERS } from "@/pull/local";
import { retryCall } from "@/pull/pull";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  const { id } = await params;
  const headers = { "cache-control": "no-store", ...FRAME_HEADERS };
  const outcome = await retryCall(id);
  if (outcome === null) return Response.json({ error: "not_found" }, { status: 404, headers });
  return Response.json({ callId: id, state: outcome.kind }, { headers });
}
