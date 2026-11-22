import { describe, expect, it } from "vitest";
import { OWNER_COOKIE, ownerCookieHeader, signOwnerCookie, verifyOwnerCookie } from "./owner";
import { signDemoCookie, verifyDemoCookie } from "./cookie";

const KEY = "key_test_secret";
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

describe("the owner cookie", () => {
  it("signs and verifies", () => {
    expect(verifyOwnerCookie(signOwnerCookie(KEY, NOW), KEY, NOW + 1000)).toBe(true);
  });

  it("is valid for 12 hours and not longer", () => {
    const value = signOwnerCookie(KEY, NOW);
    expect(verifyOwnerCookie(value, KEY, NOW + 12 * HOUR)).toBe(true);
    expect(verifyOwnerCookie(value, KEY, NOW + 12 * HOUR + 1)).toBe(false);
  });

  it("ignores a forged, edited, missing or malformed value", () => {
    const value = signOwnerCookie(KEY, NOW);
    const [issued, sig] = value.split(".");
    expect(verifyOwnerCookie(`${issued}.${"0".repeat(64)}`, KEY, NOW)).toBe(false);
    expect(verifyOwnerCookie(`${Number(issued) + 1000}.${sig}`, KEY, NOW)).toBe(false);
    expect(verifyOwnerCookie(value, "key_other", NOW)).toBe(false);
    expect(verifyOwnerCookie(`${NOW}.owner`, KEY, NOW)).toBe(false);
    expect(verifyOwnerCookie("", KEY, NOW)).toBe(false);
    expect(verifyOwnerCookie(null, KEY, NOW)).toBe(false);
    expect(verifyOwnerCookie("a.b.c", KEY, NOW)).toBe(false);
  });

  it("is not interchangeable with the demo call cookie", () => {
    expect(verifyOwnerCookie(signDemoCookie(["call_a"], KEY, NOW), KEY, NOW)).toBe(false);
    expect(verifyDemoCookie(signOwnerCookie(KEY, NOW), KEY, NOW)).toEqual([]);
  });

  it("sets httpOnly, Lax, Path=/ and 12 hours, with Secure only on https", () => {
    const value = signOwnerCookie(KEY, NOW);
    expect(ownerCookieHeader(value, true)).toBe(`${OWNER_COOKIE}=${value}; Max-Age=43200; Path=/; HttpOnly; SameSite=Lax; Secure`);
    expect(ownerCookieHeader(value, false)).not.toContain("Secure");
  });
});
