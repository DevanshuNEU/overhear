// DELETE removes one pinned call. The id must be `pin-` and up to 64 lowercase letters, digits and hyphens, and must name a
// pin file in the folder (the store checks both), so no request can reach another path. Local mode only.
import { deletePin } from "@/pinned/store";
import { assertLocalRequest } from "@/pull/local";
import { storeFailure } from "@/pull/pin";
import { failed, json } from "../_shared";

export const dynamic = "force-dynamic";

const PIN_ID = /^pin-[a-z0-9-]{1,64}$/;

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const { id } = await params;
    if (!PIN_ID.test(id)) return failed("bad_pin_id");
    await deletePin(id);
    return json({ deleted: 1 });
  } catch (err) {
    return failed(storeFailure(err));
  }
}
