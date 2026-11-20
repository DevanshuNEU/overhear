// The cookie that says which calls on the public demo are this browser's own: `overhear_demo_calls`. Its value is the time it
// was issued, up to 3 of the newest call ids and an HMAC-SHA256 over both, so a visitor cannot read another visitor's call by
// guessing its id. The signing key is derived from the Retell key, so no new secret is needed and the Retell key itself never
// signs anything:  HMAC-SHA256(RETELL_API_KEY, "overhear demo call cookie v1").
//
// Value: `{issuedAtMs}.{id1~id2~id3}.{hex signature}`. A call id is [A-Za-z0-9_-], so neither "." nor "~" can be in one.
// A bad, missing or old value means no calls: it is never an error.
import { createHmac, timingSafeEqual } from "node:crypto";
import { RETELL_ID } from "@/pull/retell-source";

export const DEMO_COOKIE = "overhear_demo_calls";
export const MAX_COOKIE_IDS = 3;
export const COOKIE_MAX_AGE_S = 60 * 60;

const KEY_LABEL = "overhear demo call cookie v1";

const signingKey = (retellKey: string): Buffer => createHmac("sha256", retellKey).update(KEY_LABEL).digest();
const mac = (retellKey: string, payload: string): Buffer => createHmac("sha256", signingKey(retellKey)).update(payload).digest();

/** The newest ids, at most MAX_COOKIE_IDS, without repeats; `newest` is last. */
export function keepNewest(ids: readonly string[]): string[] {
  const unique = ids.filter((id, i) => ids.lastIndexOf(id) === i);
  return unique.slice(-MAX_COOKIE_IDS);
}

/** The cookie value for these call ids (oldest first), signed with a key derived from the Retell key. */
export function signDemoCookie(ids: readonly string[], retellKey: string, now: number = Date.now()): string {
  const kept = keepNewest(ids.filter((id) => RETELL_ID.test(id)));
  const payload = `${Math.floor(now)}.${kept.join("~")}`;
  return `${payload}.${mac(retellKey, payload).toString("hex")}`;
}

/** The call ids a cookie value vouches for: none when it is missing, malformed, tampered with, signed with another key or older than an hour. */
export function verifyDemoCookie(value: string | null | undefined, retellKey: string, now: number = Date.now()): string[] {
  if (!value) return [];
  const parts = value.split(".");
  if (parts.length !== 3) return [];
  const [issued, idList, signature] = parts;
  if (!/^\d{1,16}$/.test(issued) || !/^[0-9a-f]{64}$/.test(signature)) return [];
  const given = Buffer.from(signature, "hex");
  const expected = mac(retellKey, `${issued}.${idList}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return [];
  const age = now - Number(issued);
  if (age > COOKIE_MAX_AGE_S * 1000 || age < -60_000) return [];
  const ids = idList.split("~").filter((id) => RETELL_ID.test(id));
  return keepNewest(ids);
}

/** The value of one cookie in a Cookie header, or undefined. */
export function cookieFromHeader(header: string | null, name: string = DEMO_COOKIE): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** The Set-Cookie header for a signed value: httpOnly, SameSite=Lax, Path=/, an hour, and Secure when the request was https. */
export function setCookieHeader(value: string, secure: boolean): string {
  return `${DEMO_COOKIE}=${value}; Max-Age=${COOKIE_MAX_AGE_S}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
