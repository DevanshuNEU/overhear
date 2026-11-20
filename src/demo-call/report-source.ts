// The report page's view of the demo calls: which calls the visitor's cookie vouches for, and the report of one of them while
// the server keeps it. Server components only (it reads the request's cookies). A copy in local mode has no demo calls.
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { isLocalMode } from "@/pull/local";
import type { CallReport } from "@/report/schema";
import { DEMO_COOKIE, verifyDemoCookie } from "./cookie";
import { cachedDemoReport } from "./store";

/** The ids of this visitor's own demo calls: none outside a request, in local mode, or for a missing or bad cookie. */
export async function yourDemoCallIds(): Promise<string[]> {
  if (isLocalMode()) return [];
  try {
    return verifyDemoCookie((await cookies()).get(DEMO_COOKIE)?.value, env.RETELL_API_KEY);
  } catch {
    return [];
  }
}

/** The report of one of this visitor's own demo calls, or undefined: another visitor's call, one the server no longer keeps, any other id. */
export async function demoCallReport(callId: string): Promise<CallReport | undefined> {
  if (!(await yourDemoCallIds()).includes(callId)) return undefined;
  return cachedDemoReport(callId);
}
