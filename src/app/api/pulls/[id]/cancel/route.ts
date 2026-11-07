// POST stops a pull: no new requests start, and outcomes already stored stay.
import { assertLocalRequest, FRAME_HEADERS } from "@/pull/local";
import { cancelPull } from "@/pull/pull";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  const { id } = await params;
  const headers = { "cache-control": "no-store", ...FRAME_HEADERS };
  if (!cancelPull(id)) return Response.json({ error: "not_found" }, { status: 404, headers });
  return Response.json({ cancelled: true }, { headers });
}
