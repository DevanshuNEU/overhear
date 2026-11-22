// The spend guard for the route that starts a Retell web call on the public demo account: /api/demo-calls. Each call
// burns Retell minutes, so every visitor gets a small budget and the whole server gets a global one, held in one limiter
// for the life of this server instance.
//
// A start is reserved before the call is made and given back when Retell did not accept it, so a failed create costs no
// one a slot. The owner of the deploy (see src/demo-call/owner.ts) skips the global and daily budgets and has a budget of
// its own per address, so a used-up public budget never blocks the demo button during a pitch.
import { RateLimiter, type RateLimitEntry } from "@/lib/rate-limit";

const limiter = new RateLimiter();
export const PER_IP = { limit: 3, windowMs: 10 * 60 * 1000 };
export const PER_IP_DAILY = { limit: 6, windowMs: 24 * 60 * 60 * 1000 };
export const GLOBAL = { limit: 30, windowMs: 60 * 60 * 1000 };
export const OWNER_PER_IP = { limit: 10, windowMs: 10 * 60 * 1000 };

export function clientIp(req: Request): string {
  // Railway's edge sets X-Real-IP to the client's remote address (docs.railway.com, Specs & Limits, Request Headers). It
  // does not protect X-Forwarded-For: a live test on 2026-11-22 showed four starts with a different X-Forwarded-For each
  // all counted as different visitors. So X-Real-IP decides. Without it (another host), the last X-Forwarded-For entry,
  // then one shared bucket.
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const entries = (req.headers.get("x-forwarded-for") ?? "").split(",");
  return entries[entries.length - 1].trim() || "unknown";
}

export type WebCallReservation = { allowed: true; refund: () => void } | { allowed: false; retryAfter: number };

/**
 * Reserves one start from the budgets that apply, or says how many seconds until a start is allowed. Call `refund` when the
 * start did not happen; it is safe to call more than once.
 */
export function reserveWebCall(req: Request, owner = false): WebCallReservation {
  const ip = clientIp(req);
  const entries: RateLimitEntry[] = owner
    ? [{ key: `web-call:owner-ip:${ip}`, rule: OWNER_PER_IP }]
    : [
        { key: `web-call:ip:${ip}`, rule: PER_IP },
        { key: `web-call:ip-daily:${ip}`, rule: PER_IP_DAILY },
        { key: "web-call:global", rule: GLOBAL },
      ];
  const rl = limiter.check(entries);
  if (!rl.allowed || rl.at === undefined) return { allowed: false, retryAfter: Math.ceil(rl.retryAfterMs / 1000) };
  const at = rl.at;
  let given = false;
  return {
    allowed: true,
    refund: () => {
      if (given) return;
      given = true;
      limiter.refund(entries, at);
    },
  };
}

/** For tests: forget every count. */
export function resetWebCallLimit(): void {
  limiter.reset();
}
