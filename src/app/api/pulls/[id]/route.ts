// GET reports a pull's progress: counts and one row per call. Never the key and never a full report.
import { assertLocalRequest, FRAME_HEADERS } from "@/pull/local";
import { getProgress } from "@/pull/pull";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  const { id } = await params;
  const progress = getProgress(id);
  const headers = { "cache-control": "no-store", ...FRAME_HEADERS };
  if (!progress) return Response.json({ error: "not_found" }, { status: 404, headers });
  return Response.json(progress, { headers });
}
