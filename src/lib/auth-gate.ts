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
