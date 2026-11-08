// Pinned calls. POST pins a call (it fetches the call from Retell once, with the stored key), GET lists the pins with a
// fresh offline check, DELETE removes every pin. Local mode only: a hosted copy answers 404 (src/proxy.ts says so too),
// and the loopback, Host and Origin checks run here as well as in the proxy.
// No answer holds a word of a call, the key or what Retell said: a pin is summed up by its id, its call id, when and
// with what it was made, what it kept, its note and whether it still holds. See src/pull/pin.ts for the steps of a pin.
import { analyzeRetellCall } from "@/engine/analyze";
import { checkPins } from "@/pinned/check";
import { deleteAllPins, listPins } from "@/pinned/store";
import { assertLocalRequest } from "@/pull/local";
import { boundedBodyText } from "@/pull/request-body";
import { parsePinBody, pinCall, storeFailure } from "@/pull/pin";
import { failed, json } from "./_shared";

export const dynamic = "force-dynamic";

// A pin request is a call id, a few names and a note of at most 280 characters.
const MAX_BODY = 4096;

export async function POST(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const body = await boundedBodyText(request, MAX_BODY);
    if ("code" in body) return failed(body.code);
    const parsed = parsePinBody(body.text);
    if (!parsed.ok) return failed(parsed.code);
    const pinned = await pinCall(parsed.input);
    return pinned.ok ? json({ id: pinned.id, status: "pinned" }) : failed(pinned.code);
  } catch {
    return failed("failed");
  }
}

export async function GET(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const { pins, problems } = await listPins();
    // The engine's own message for a call it cannot read (it can quote the call) stays in the check and goes no further.
    const checks = checkPins(pins, analyzeRetellCall);
    const summaries = checks.map((c, i) => ({
      id: c.id,
      callId: c.callId,
      pinnedAt: c.pinnedAt,
      pinnedWith: c.pinnedWith,
      agentVersion: pins[i].pin.pin?.agentVersion ?? null,
      kept: c.expected,
      note: c.note,
      status: c.status,
      changes: c.changes,
    }));
    return json({ pins: summaries, problems });
  } catch (err) {
    return failed(storeFailure(err));
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const { deleted, skipped } = await deleteAllPins();
    return json({ deleted, problems: skipped });
  } catch (err) {
    return failed(storeFailure(err));
  }
}
