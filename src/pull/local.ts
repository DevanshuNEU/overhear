// Local mode: the product runs on the user's own machine (`OVERHEAR_LOCAL=1`). Without it the app is a hosted
// copy, such as the Railway demo, where `/` sends visitors to the demo at /demo and the product routes answer 404.
//
// In local mode the server holds a Retell key that can read every call on the account, so it answers only this
// computer:
// - `npm run local` binds 127.0.0.1, so nothing on the network can connect at all.
// - Every request must carry a loopback Host (localhost, 127.0.0.1 or [::1], any port). A web page that points its
//   own domain at 127.0.0.1 (DNS rebinding) still sends its own name as Host, so it is refused.
// - Every request that can change something (any method but GET and HEAD) must carry an Origin equal to its own
//   Host. A page on another site, another port or a sandboxed frame (`Origin: null`) cannot set or remove the key.
// - A Host check is not authentication: a machine on the network can send `Host: localhost`. So local mode also
//   refuses every request when the server was started on anything but 127.0.0.1 (say `OVERHEAR_LOCAL=1` sits in
//   .env and someone runs plain `npm run dev`, which binds every interface). Next records the address it serves
//   in `__NEXT_PRIVATE_ORIGIN`; when that is missing (tests, or a future Next) this one check cannot tell and
//   lets the others decide.
// These checks run in src/proxy.ts for every path and again in each product route handler.
// Pure and dependency-free, so the proxy can import it.
import { LOCAL_REFUSAL } from "./labels";

export function isLocalMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.OVERHEAR_LOCAL === "1";
}

// The whole Host header: a loopback name, then an optional port of digits. Nothing before or after.
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/;

/** True when the Host header names this computer. A missing Host is not loopback. */
export function isLoopbackHost(host: string | null | undefined): boolean {
  if (!host) return false;
  return LOOPBACK_HOST.test(host.toLowerCase());
}

/** True when the Origin header is exactly this request's own scheme and Host. `null` and a missing Origin fail. */
export function isSameOrigin(origin: string | null | undefined, host: string | null | undefined): boolean {
  if (!origin || !host) return false;
  const o = origin.toLowerCase();
  const h = host.toLowerCase();
  return o === `http://${h}` || o === `https://${h}`;
}

/**
 * False when Next says it is serving on an address other than 127.0.0.1. Next writes `localhost` for both a
 * 0.0.0.0 bind and a `localhost` bind, and `[::1]` for both `::` and `::1`, so only 127.0.0.1 is trusted.
 */
export function isLoopbackBind(env: Record<string, string | undefined> = process.env): boolean {
  const origin = env.__NEXT_PRIVATE_ORIGIN;
  if (!origin) return true;
  try {
    return new URL(origin).hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

// The routes that hold or use the key: the key itself, pulls and per-call refetches. Hosted copies answer 404.
const PRODUCT_API_PREFIXES = ["/api/connect", "/api/pulls", "/api/calls"];

/** True for a path under one of the product API routes, matched on a path boundary. */
export function isProductApiPath(pathname: string): boolean {
  return PRODUCT_API_PREFIXES.some((base) => pathname === base || pathname.startsWith(base + "/"));
}

function refusal(status: 403 | 404, text: string = status === 404 ? LOCAL_REFUSAL.notFound : LOCAL_REFUSAL.forbidden): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/**
 * The local check for one request: a 403 when the server is not bound to 127.0.0.1, for a foreign Host, or for a
 * request that can change something without a same-origin Origin; null when the request may go on. Does not look
 * at local mode; see assertLocalRequest.
 */
export function checkLocalRequest(req: Request, env: Record<string, string | undefined> = process.env): Response | null {
  if (!isLoopbackBind(env)) return refusal(403, LOCAL_REFUSAL.wrongBind);
  const host = req.headers.get("host");
  if (!isLoopbackHost(host)) return refusal(403);
  if (!SAFE_METHODS.has(req.method.toUpperCase()) && !isSameOrigin(req.headers.get("origin"), host)) return refusal(403);
  return null;
}

/**
 * For product route handlers: a 404 when local mode is off, otherwise the local check. Null means the request
 * may go on.
 */
export function assertLocalRequest(req: Request, env: Record<string, string | undefined> = process.env): Response | null {
  if (!isLocalMode(env)) return refusal(404);
  return checkLocalRequest(req, env);
}

/** For the proxy on a hosted copy: the product API routes answer 404. */
export function hostedNotFound(): Response {
  return refusal(404);
}
