// GET /owner: for the owner of a hosted copy, to open before a demo. It sets the owner cookie and sends the browser to `/`,
// where the call button then skips the public budgets. It is never public: the proxy keeps it behind the password even with
// OVERHEAR_PUBLIC_SAMPLES=1, and this route checks the password again. With no password set, or in local mode, there is no
// such page.
import { checkBasicAuth } from "@/lib/auth-gate";
import { env } from "@/lib/env";
import { hostedNotFound, isLocalMode } from "@/pull/local";
import { isHttps } from "@/demo-call/http";
import { ownerCookieHeader, signOwnerCookie } from "@/demo-call/owner";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const password = process.env.DASHBOARD_PASSWORD;
  if (isLocalMode() || !password) return hostedNotFound();
  if (!checkBasicAuth(req.headers.get("authorization"), password)) {
    return new Response("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Overhear"', "cache-control": "no-store" },
    });
  }
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "cache-control": "no-store",
      "set-cookie": ownerCookieHeader(signOwnerCookie(env.RETELL_API_KEY), isHttps(req)),
    },
  });
}
