// Runs before every request the matcher lets in: the shared-password access gate for the deployed demo, and the
// redirect for old demo links.
//
// Note for future readers: this project is on Next.js 16, where the
// `middleware.ts` file convention is deprecated in favor of `proxy.ts` (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
// This file intentionally uses the current `proxy` convention rather than
// the deprecated `middleware` one.
//
// Reads `DASHBOARD_PASSWORD` directly from `process.env` rather than
// importing `@/lib/env` (the zod-validated env module), so this file has no
// dependency on the full env schema and stays light. If the password is
// unset or empty, every request is allowed through (local dev stays open).
//
// Machine-to-machine routes (`/api/tools/*`, `/api/webhooks/retell`) are
// already verified by `verifyRetellSignature` and must keep working for
// Retell's servers even when a password is set, so they are excluded both
// by the matcher below and by an in-handler allowlist check.
//
// Order of the checks, for every path the matcher lets in:
// 1. Excluded paths pass untouched.
// 2. Local mode (`OVERHEAR_LOCAL=1`, see src/pull/local.ts): every request needs a loopback Host, and every request
//    that can change something needs a same-origin Origin, or it gets a 403. This covers the server-rendered pages
//    that show call transcripts too. On a hosted copy the product API routes (`/api/connect`, `/api/pulls`,
//    `/api/calls/`) answer 404 instead; `/reports/` stays served, because there it shows only the samples. The
//    route handlers repeat this check, so a path the matcher misses is still covered.
// 3. The shared password, when one is set.
// 4. Old demo links (`/calls/{id}`, from before the demo moved to `/demo`) redirect to `/demo/calls/{id}`. This
//    runs after the password, so a visitor without it gets a 401 here, as before the move.
import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth, isExcludedPath } from "@/lib/auth-gate";
import { movedDemoPath } from "@/lib/demo-paths";
import { checkLocalRequest, hostedNotFound, isLocalMode, isProductApiPath } from "@/pull/local";

export function proxy(request: NextRequest): Response {
  const { pathname } = request.nextUrl;
  if (isExcludedPath(pathname)) return NextResponse.next();

  if (isLocalMode()) {
    const refused = checkLocalRequest(request);
    if (refused) return refused;
  } else if (isProductApiPath(pathname)) {
    return hostedNotFound();
  }

  const denied = passwordGate(request);
  if (denied) return denied;

  const moved = movedDemoPath(pathname);
  if (moved) {
    const url = request.nextUrl.clone();
    url.pathname = moved;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

/** A 401 when a password is set and the request does not carry it; null when the request may go on. */
function passwordGate(request: NextRequest): NextResponse | null {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return null;
  if (checkBasicAuth(request.headers.get("authorization"), password)) return null;
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Overhear"' },
  });
}

export const config = {
  matcher: ["/((?!api/tools/|api/webhooks/retell|api/health|_next/|favicon.ico).*)"],
};
