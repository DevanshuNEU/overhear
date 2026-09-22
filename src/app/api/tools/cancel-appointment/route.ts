import { makeToolRoute } from "../_shared";
export const POST = makeToolRoute(({ args, svc, callId }) => svc.cancelAppointment(callId, args));
