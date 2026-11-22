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
// unset or empty, a local copy and `next dev` let every request through; a hosted production copy answers 503 (step 3c).
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
//    `/api/test-calls`, `/api/files`) answer 404.
//    `/reports/` stays served, because there it shows only the samples.
// 3-. Old demo links (`/demo`, `/demo/calls/{id}`, `/calls/{id}`) redirect permanently to `/`. This runs before the
//    password: the redirect reveals nothing, and `/` then asks for whatever it asks for.
// 3a. A change (POST) to the demo call routes needs a same-origin Origin, with or without the password.
// 3b. Hosted copy with OVERHEAR_PUBLIC_SAMPLES=1: `/`, `/reports/*` and the demo call routes (`/api/demo-calls`,
//    `/api/demo-calls/*`) pass without the password. Unset means this
//    step does not exist.
// 3c. Hosted copy with no password (and not `next dev`): every path that reached this step answers 503, "This copy has
//    no password set." Only the excluded paths and, with the flag, the public sample paths are served.
// 4. The shared password, when one is set. `/owner` is not a public sample path, so it always lands here.
import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth, isDemoCallPath, isExcludedPath, isPublicSamplePath, requestScheme, sameOriginRequest } from "@/lib/auth-gate";
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
  const moved = movedResponse(request);
  if (moved) return moved;
  // A call started from another site would spend our Retell minutes: a POST to the demo call routes must be same-origin,
  // with or without the password. (The route repeats the check.)
  if (isDemoCallPath(pathname) && request.method !== "GET" && request.method !== "HEAD" && !sameOriginRequest(request.headers.get("origin"), request.headers.get("host") ?? request.nextUrl.host, requestScheme(request.headers.get("x-forwarded-proto"), request.url))) {
    return new NextResponse("Forbidden", { status: 403, headers: { "cache-control": "no-store" } });
  }
  // Opt in, set by whoever owns the deploy: the sample calls are public, every other path keeps the password.
  if (process.env.OVERHEAR_PUBLIC_SAMPLES === "1" && isPublicSamplePath(pathname)) return NextResponse.next();
  // Fail closed: a hosted copy that lost its password (a blank variable after a redeploy) must not open every page.
  // Only `next dev` keeps the open behaviour, so contributors can work without setting one.
  if (!process.env.DASHBOARD_PASSWORD && process.env.NODE_ENV !== "development") return noPassword();
  return gate(request);
}

/** The answer on a hosted copy with no password: a plain sentence, never the page. */
function noPassword(): Response {
  return new NextResponse("This copy has no password set.", { status: 503, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
}

/** Excluded paths pass; old demo links redirect; everything else meets the password. */
function gate(request: NextRequest): Response {
  const { pathname } = request.nextUrl;
  if (isExcludedPath(pathname)) return NextResponse.next();

  const moved = movedResponse(request);
  if (moved) return moved;

  return passwordGate(request) ?? NextResponse.next();
}

/** A permanent redirect to `/` for an old demo link, or null for any other path. */
function movedResponse(request: NextRequest): Response | null {
  const target = movedDemoPath(request.nextUrl.pathname);
  if (!target) return null;
  const url = request.nextUrl.clone();
  url.pathname = target;
  url.search = "";
  return NextResponse.redirect(url, 308);
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
