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
// Retell's servers even when a password is set, so they skip the password
// (see `isExcludedPath`). The matcher runs the proxy on every path, those and
// Next's own files included, so local mode can check them too.
//
// Order of the checks, for every path:
// 1. Local mode only (`OVERHEAR_LOCAL=1`, see src/pull/local.ts): the server must be bound to 127.0.0.1, every
//    request needs a loopback Host, and every request that can change something needs a same-origin Origin, or it
//    gets a 403. This runs before the excluded paths, so health, `/_next/*`, the tools and the webhook answer only
//    this computer too, and it covers the server-rendered pages that show call transcripts. Every local-mode
//    answer also forbids framing. The route handlers repeat this check.
// 2. Excluded paths pass untouched.
// 3. Hosted copy only: the product API routes (`/api/connect`, `/api/pulls`, `/api/calls/`, `/api/pins`, `/api/agents`,
//    `/api/test-calls`) answer 404.
//    `/reports/` stays served, because there it shows only the samples.
// 3a. A change (POST) to the demo call routes needs a same-origin Origin, with or without the password.
// 3b. Hosted copy with OVERHEAR_PUBLIC_SAMPLES=1: `/`, `/reports/*` and the demo call routes (`/api/demo-calls`,
//    `/api/demo-calls/*`) pass without the password. Unset means this
//    step does not exist.
// 4. The shared password, when one is set.
// 5. Old demo links (`/calls/{id}`, from before the demo moved to `/demo`) redirect to `/demo/calls/{id}`. This
//    runs after the password, so a visitor without it gets a 401 here, as before the move.
import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth, isDemoCallPath, isExcludedPath, isPublicSamplePath, sameOriginRequest } from "@/lib/auth-gate";
import { movedDemoPath } from "@/lib/demo-paths";
import { checkLocalRequest, forbidFraming, hostedNotFound, isLocalMode, isProductApiPath } from "@/pull/local";

export function proxy(request: NextRequest): Response {
  if (!isLocalMode()) return hosted(request);
  const refused = checkLocalRequest(request);
  if (refused) return refused;
  const res = gate(request);
  forbidFraming(res.headers);
  return res;
}

/** A hosted copy: excluded paths untouched, then the product API routes 404, then the shared gate. */
function hosted(request: NextRequest): Response {
  const { pathname } = request.nextUrl;
  if (isExcludedPath(pathname)) return NextResponse.next();
  if (isProductApiPath(pathname)) return hostedNotFound();
  // A call started from another site would spend our Retell minutes: a POST to the demo call routes must be same-origin,
  // with or without the password. (The route repeats the check.)
  if (isDemoCallPath(pathname) && request.method !== "GET" && request.method !== "HEAD" && !sameOriginRequest(request.headers.get("origin"), request.headers.get("host") ?? request.nextUrl.host)) {
    return new NextResponse("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  // Opt in, set by whoever owns the deploy: the sample calls are public, every other path keeps the password.
  if (process.env.OVERHEAR_PUBLIC_SAMPLES === "1" && isPublicSamplePath(pathname)) return NextResponse.next();
  return gate(request);
}

/** Excluded paths pass; everything else meets the password, then the old demo link redirect. */
function gate(request: NextRequest): Response {
  const { pathname } = request.nextUrl;
  if (isExcludedPath(pathname)) return NextResponse.next();

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

// Every path. Excluded paths are let through in code (step 2 above), after local mode has checked them.
export const config = {
  matcher: ["/(.*)"],
};
