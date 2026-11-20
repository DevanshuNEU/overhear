// GET where a call on the public demo stands: { status: "processing" }, { status: "ready", row }, { status: "timeout" } or
// { status: "did_not_connect" }. Only for a call id in this browser's signed cookie, and only for a call of the demo agent;
// anything else is a 404. Hosted only. See src/demo-call/store.ts for the steps of an answer.
import { demoCallIds, failed, json, refuseLocal } from "@/demo-call/http";
import { demoCallResult } from "@/demo-call/store";
import { RETELL_ID } from "@/pull/retell-source";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ callId: string }> }): Promise<Response> {
  const local = refuseLocal();
  if (local) return local;
  const { callId } = await params;
  if (!RETELL_ID.test(callId)) return failed("not_found");
  if (!demoCallIds(req).includes(callId)) return failed("not_found");
  const answer = await demoCallResult(callId);
  return answer.ok ? json({ ...answer.result }) : failed(answer.code);
}
