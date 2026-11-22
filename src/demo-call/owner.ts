// The cookie that says this browser belongs to the owner of a hosted copy: `overhear_owner`. It is set by visiting /owner,
// which sits behind the password, and it lets the owner's demo button skip the public budgets (see src/lib/web-call-limit.ts).
// Signed like the demo call cookie but under its own label, so neither cookie can stand in for the other:
// HMAC-SHA256(RETELL_API_KEY, "overhear owner cookie v1"). Value: `{issuedAtMs}.{hex signature}`, valid for 12 hours.
import { createHmac, timingSafeEqual } from "node:crypto";

export const OWNER_COOKIE = "overhear_owner";
export const OWNER_COOKIE_MAX_AGE_S = 12 * 60 * 60;

const KEY_LABEL = "overhear owner cookie v1";

const signingKey = (retellKey: string): Buffer => createHmac("sha256", retellKey).update(KEY_LABEL).digest();
const mac = (retellKey: string, payload: string): Buffer => createHmac("sha256", signingKey(retellKey)).update(payload).digest();

/** The cookie value for an owner who arrived at `now`. */
export function signOwnerCookie(retellKey: string, now: number = Date.now()): string {
  const payload = String(Math.floor(now));
  return `${payload}.${mac(retellKey, payload).toString("hex")}`;
}

/** True only for a value this server signed with this key, less than 12 hours ago. A missing, malformed or forged value is false, never an error. */
export function verifyOwnerCookie(value: string | null | undefined, retellKey: string, now: number = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 2) return false;
  const [issued, signature] = parts;
  if (!/^\d{1,16}$/.test(issued) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const given = Buffer.from(signature, "hex");
  const expected = mac(retellKey, issued);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  const age = now - Number(issued);
  return age <= OWNER_COOKIE_MAX_AGE_S * 1000 && age >= -60_000;
}

/** The Set-Cookie header for a signed value: httpOnly, SameSite=Lax, Path=/, 12 hours, and Secure when the request was https. */
export function ownerCookieHeader(value: string, secure: boolean): string {
  return `${OWNER_COOKIE}=${value}; Max-Age=${OWNER_COOKIE_MAX_AGE_S}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
