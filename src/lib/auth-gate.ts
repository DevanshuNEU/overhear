// Pure, dependency-free helpers for the shared-password access gate in
// `src/proxy.ts`. Kept separate (and free of `@/lib/env`) so the gate stays
// light and so the decision logic is unit-testable without a real request.

// Paths that must always be reachable without the password: Retell's own
// server-to-server callbacks (verified by request signature, not the
// password), the health check, and Next internals/static files.
const EXCLUDED_PREFIXES = [
  "/api/tools/",
  "/api/webhooks/retell",
  "/api/health",
  "/_next/",
  "/favicon.ico",
];

export function isExcludedPath(pathname: string): boolean {
  // Match on a path boundary so "/api/health" does not also exclude
  // "/api/healthy". A prefix matches only as an exact path or a real subpath.
  return EXCLUDED_PREFIXES.some((prefix) => {
    const base = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
    return pathname === base || pathname.startsWith(base + "/");
  });
}

/**
 * The pages the public sample calls need: the list at "/" and a report at "/reports/{id}". With
 * OVERHEAR_PUBLIC_SAMPLES=1 on a hosted copy these skip the password. Nothing else does, and Next's own files are
 * already excluded above.
 */
export function isPublicSamplePath(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/reports/") || isDemoCallPath(pathname);
}

/** The routes of the live demo call: "/api/demo-calls" and "/api/demo-calls/{id}". They skip the password only with the same flag as the samples. */
export function isDemoCallPath(pathname: string): boolean {
  return pathname === "/api/demo-calls" || pathname.startsWith("/api/demo-calls/");
}

/**
 * False when the request names an Origin that is not the one it was sent to: scheme, host and port must all match, so
 * `http://x` is not `https://x`. A request with no Origin (a plain navigation, a script) passes: a browser sends one on
 * every cross-site POST, which is the case this stops.
 */
export function sameOriginRequest(origin: string | null, host: string | null, scheme: "http" | "https"): boolean {
  if (origin === null) return true;
  try {
    return host !== null && new URL(origin).origin === new URL(`${scheme}://${host}`).origin;
  } catch {
    return false;
  }
}

/**
 * The scheme a request was sent with. Railway terminates TLS, so the URL the server sees may say http while the visitor used
 * https: x-forwarded-proto (the last entry, the one the edge proxy appends) wins when present, else the request URL's.
 */
export function requestScheme(forwardedProto: string | null, url: string): "http" | "https" {
  const proto = (forwardedProto ?? "").split(",").pop()?.trim().toLowerCase();
  if (proto === "http" || proto === "https") return proto;
  return new URL(url).protocol === "https:" ? "https" : "http";
}

// Decodes a `Basic base64(user:pass)` Authorization header and checks the
// password half against the expected value. Any username is accepted.
export function checkBasicAuth(authHeader: string | null, expectedPassword: string): boolean {
  if (!authHeader || !authHeader.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(authHeader.slice("Basic ".length));
  } catch {
    return false;
  }
  const sep = decoded.indexOf(":");
  const password = sep === -1 ? "" : decoded.slice(sep + 1);
  // Plain compare is fine here: this is a shared, non-secret demo password,
  // not a per-user credential, so a timing-safe compare is not warranted.
  return password === expectedPassword;
}
