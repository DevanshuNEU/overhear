import { makeToolRoute } from "../_shared";

// Cap returned slots so a large availability list can't blow the response
// size cap in `_shared.ts` on its own.
export const POST = makeToolRoute(async ({ args, svc, callId }) => {
  const { result } = await svc.checkAvailability(callId, args);
  return { result: { slots: result.slots.slice(0, 20) } };
});
