// Shared-password access gate for the deployed demo.
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
import { NextResponse, type NextRequest } from "next/server";
import { checkBasicAuth, isExcludedPath } from "@/lib/auth-gate";

export function proxy(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (isExcludedPath(pathname)) return NextResponse.next();

  const authHeader = request.headers.get("authorization");
  if (!checkBasicAuth(authHeader, password)) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Overhear"' },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/tools/|api/webhooks/retell|api/health|_next/|favicon.ico).*)"],
};
