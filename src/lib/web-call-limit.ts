// The spend guard for every route that starts a Retell web call on the public demo account: /api/web-call and
// /api/demo-calls. Each call burns Retell minutes, so the two routes share one per-visitor budget and one global budget,
// held in one limiter for the life of this server instance. A visitor cannot get 3 calls from each route.
import { RateLimiter } from "@/lib/rate-limit";

const limiter = new RateLimiter();
export const PER_IP = { limit: 3, windowMs: 10 * 60 * 1000 };
export const GLOBAL = { limit: 30, windowMs: 60 * 60 * 1000 };

export function clientIp(req: Request): string {
  // Railway's edge proxy appends the address it saw to x-forwarded-for. Anything before that last entry was sent by the
  // client, who can put anything there, so only the last entry counts. Fall back to a shared bucket if it is missing.
  const entries = (req.headers.get("x-forwarded-for") ?? "").split(",");
  return entries[entries.length - 1].trim() || "unknown";
}

/** Takes one start from the visitor's budget and the global one, or says how many seconds until a start is allowed. */
export function checkWebCallLimit(req: Request): { allowed: true } | { allowed: false; retryAfter: number } {
  const rl = limiter.check([
    { key: `web-call:ip:${clientIp(req)}`, rule: PER_IP },
    { key: "web-call:global", rule: GLOBAL },
  ]);
  return rl.allowed ? { allowed: true } : { allowed: false, retryAfter: Math.ceil(rl.retryAfterMs / 1000) };
}
