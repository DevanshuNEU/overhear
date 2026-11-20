// What the two demo call routes share: how an answer leaves (no caching, fixed sentences), the hosted-only refusal, the
// same-origin check and the cookie read.
import { env } from "@/lib/env";
import { requestScheme, sameOriginRequest } from "@/lib/auth-gate";
import { hostedNotFound, isLocalMode } from "@/pull/local";
import { cookieFromHeader, verifyDemoCookie } from "./cookie";
import { DEMO_CALL_MESSAGE, DEMO_CALL_STATUS, type DemoCallErrorCode } from "./words";

export const NO_STORE = { "cache-control": "no-store" } as const;

export function json(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export function failed(code: DemoCallErrorCode, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}): Response {
  return json({ error: code, message: DEMO_CALL_MESSAGE[code], ...extra }, DEMO_CALL_STATUS[code], headers);
}

/** The demo is hosted only: in local mode every entry point answers 404, as the other hosted-only pages do. Null when the request may go on. */
export function refuseLocal(): Response | null {
  return isLocalMode() ? hostedNotFound() : null;
}

/** False when the request names an Origin that is not this host. A request with no Origin (a plain navigation, a script) passes. */
export function sameOrigin(req: Request): boolean {
  return sameOriginRequest(req.headers.get("origin"), req.headers.get("host") ?? new URL(req.url).host, requestScheme(req.headers.get("x-forwarded-proto"), req.url));
}

/** The call ids the request's cookie vouches for. None for a missing or bad cookie. */
export function demoCallIds(req: Request): string[] {
  return verifyDemoCookie(cookieFromHeader(req.headers.get("cookie")), env.RETELL_API_KEY);
}
