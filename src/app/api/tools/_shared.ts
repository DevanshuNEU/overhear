/* eslint-disable @typescript-eslint/no-explicit-any -- Retell's tool-call payload's `args` shape
 * varies per tool (each `ClinicService` method has its own args type), and the raw webhook body
 * is untyped JSON off the wire. Narrowing happens inside each ClinicService method; this shared
 * dispatcher intentionally stays untyped at that boundary. */
import { NextResponse } from "next/server";
import { verifyRetellSignature } from "@/retell/verify";
import { makeClinicService, type ClinicService } from "@/clinic/service";
import { db } from "@/db/client";

// Every ClinicService method resolves `{ result: R }` (see `Out<R>` in
// `@/clinic/service`). Retell's tool-call webhook expects the flat `R`
// payload back, so this is where that one wrapper layer is stripped -
// keeping each thin route a one-line passthrough to its service method.
type Handler = (ctx: { callId: string; args: any; svc: ClinicService }) => Promise<{ result: unknown }>;

export function makeToolRoute(handler: Handler) {
  return async function POST(req: Request) {
    const raw = await req.text(); // raw body - required for signature verification
    if (!(await verifyRetellSignature(raw, req.headers.get("x-retell-signature")))) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
    const body = JSON.parse(raw) as { name: string; call: { call_id: string }; args?: any };
    const svc = makeClinicService(db);
    const { result } = await handler({ callId: body.call.call_id, args: body.args ?? {}, svc });
    const json = JSON.stringify(result);
    return new NextResponse(json.slice(0, 15000), { headers: { "content-type": "application/json" } });
  };
}
