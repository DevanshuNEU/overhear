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
  return EXCLUDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
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
  return password === expectedPassword;
}
