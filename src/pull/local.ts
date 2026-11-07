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
//   refuses every request unless the server was started on 127.0.0.1 (say `OVERHEAR_LOCAL=1` sits in .env and
//   someone runs plain `npm run dev`, which binds every interface). See isLoopbackBind.
// - A call screen (/reports/...) opened by another website as an image, script, frame or fetch is refused: opening
//   one can cost a Retell request, so a page that loops over made-up ids must not be able to spend them. Only a
//   top-level navigation (the user following a link) may come from another site. See isCrossSiteSubresource.
// - Every answer forbids framing (FRAME_HEADERS), so a page on another site cannot frame the local server to
//   clickjack a disconnect or a pull, or show transcripts inside its own page.
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
 * True only when Next says it is serving on 127.0.0.1.
 *
 * Why an internal Next variable: a request handler cannot see the address the server listens on, and Next
 * exposes no public way to ask. Its start-server writes the address to `process.env.__NEXT_PRIVATE_ORIGIN` when
 * it starts listening (`next dev` and `next start` alike). It writes `localhost` for both a 0.0.0.0 bind and a
 * `localhost` bind, and `[::1]` for both `::` and `::1`, so only 127.0.0.1 is trusted.
 *
 * It fails closed: when the variable is missing, local mode refuses every request. If a Next upgrade drops or
 * renames it, `npm run local` answers 403 everywhere until this check is moved to what Next records instead; a
 * test in boundaries.test.ts reads Next's start-server and fails at upgrade time. Tests opt in by setting the
 * variable to a 127.0.0.1 origin themselves; nothing here assumes it.
 */
export function isLoopbackBind(env: Record<string, string | undefined> = process.env): boolean {
  const origin = env.__NEXT_PRIVATE_ORIGIN;
  if (!origin) return false;
  try {
    return new URL(origin).hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Sent on every local-mode answer: no other page may frame this one. */
export const FRAME_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY",
};

/** Adds FRAME_HEADERS to a response's headers, in place. */
export function forbidFraming(headers: Headers): void {
  for (const [name, value] of Object.entries(FRAME_HEADERS)) headers.set(name, value);
}

const SAFE_METHODS = new Set(["GET", "HEAD"]);

// The routes that hold or use the key: the key itself, pulls and per-call refetches. Hosted copies answer 404.
const PRODUCT_API_PREFIXES = ["/api/connect", "/api/pulls", "/api/calls"];

/** True for a path under one of the product API routes, matched on a path boundary. */
export function isProductApiPath(pathname: string): boolean {
  return PRODUCT_API_PREFIXES.some((base) => pathname === base || pathname.startsWith(base + "/"));
}

function refusal(status: 403 | 404, text: string = status === 404 ? LOCAL_REFUSAL.notFound : LOCAL_REFUSAL.forbidden): Response {
  return new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...FRAME_HEADERS } });
}

/**
 * True for a GET or HEAD to /reports/ that another site (or another port on this computer, which is same-site) made
 * as a subresource: the browser says so in Sec-Fetch-Site, and Sec-Fetch-Dest is anything but `document`. A
 * top-level navigation, the same origin, a typed address (`none`) and a client that sends no Fetch Metadata pass.
 */
export function isCrossSiteSubresource(req: Request): boolean {
  if (!SAFE_METHODS.has(req.method.toUpperCase())) return false;
  let pathname: string;
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    return false;
  }
  if (pathname !== "/reports" && !pathname.startsWith("/reports/")) return false;
  const site = req.headers.get("sec-fetch-site")?.toLowerCase();
  if (site !== "cross-site" && site !== "same-site") return false;
  return req.headers.get("sec-fetch-dest")?.toLowerCase() !== "document";
}

/**
 * The local check for one request: a 403 when the server is not bound to 127.0.0.1, for a foreign Host, or for a
 * request that can change something without a same-origin Origin, and for a call screen another site loads as a
 * subresource; null when the request may go on. Does not look
 * at local mode; see assertLocalRequest.
 */
export function checkLocalRequest(req: Request, env: Record<string, string | undefined> = process.env): Response | null {
  if (!isLoopbackBind(env)) return refusal(403, LOCAL_REFUSAL.wrongBind);
  const host = req.headers.get("host");
  if (!isLoopbackHost(host)) return refusal(403);
  if (!SAFE_METHODS.has(req.method.toUpperCase()) && !isSameOrigin(req.headers.get("origin"), host)) return refusal(403);
  if (isCrossSiteSubresource(req)) return refusal(403);
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
