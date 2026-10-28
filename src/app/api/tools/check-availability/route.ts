import { makeToolRoute } from "../_shared";
// The service caps and orders the slots before logging them, so the log holds
// exactly what the agent was shown.
export const POST = makeToolRoute(({ args, svc, callId }) => svc.checkAvailability(callId, args));
