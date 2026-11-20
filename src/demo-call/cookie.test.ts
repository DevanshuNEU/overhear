import { describe, expect, it } from "vitest";
import { COOKIE_MAX_AGE_S, cookieFromHeader, setCookieHeader, signDemoCookie, verifyDemoCookie } from "./cookie";

const KEY = "key_test_1";
const NOW = 1_700_000_000_000;

describe("the demo call cookie", () => {
  it("signs call ids and reads them back", () => {
    const value = signDemoCookie(["call_a", "call_b"], KEY, NOW);
    expect(verifyDemoCookie(value, KEY, NOW + 1000)).toEqual(["call_a", "call_b"]);
  });

  it("is not a value with a call id in the clear that anyone could write", () => {
    expect(verifyDemoCookie("1700000000000.call_a.deadbeef", KEY, NOW)).toEqual([]);
  });

  it("rejects a value with an id added or swapped", () => {
    const [issued, , sig] = signDemoCookie(["call_a"], KEY, NOW).split(".");
    expect(verifyDemoCookie(`${issued}.call_other.${sig}`, KEY, NOW)).toEqual([]);
    expect(verifyDemoCookie(`${issued}.call_a~call_other.${sig}`, KEY, NOW)).toEqual([]);
  });

  it("rejects a value whose time was changed, so it cannot be kept alive", () => {
    const [, ids, sig] = signDemoCookie(["call_a"], KEY, NOW).split(".");
    expect(verifyDemoCookie(`${NOW + 3_000_000}.${ids}.${sig}`, KEY, NOW + 4_000_000)).toEqual([]);
  });

  it("rejects a value signed with another key", () => {
    const value = signDemoCookie(["call_a"], "another_key", NOW);
    expect(verifyDemoCookie(value, KEY, NOW)).toEqual([]);
  });

  it("keeps the newest 3 ids when given more", () => {
    const value = signDemoCookie(["c1", "c2", "c3", "c4", "c5"], KEY, NOW);
    expect(verifyDemoCookie(value, KEY, NOW)).toEqual(["c3", "c4", "c5"]);
  });

  it("does not repeat an id, and the repeat counts as the newest", () => {
    expect(verifyDemoCookie(signDemoCookie(["c1", "c2", "c1"], KEY, NOW), KEY, NOW)).toEqual(["c2", "c1"]);
  });

  it("expires after an hour", () => {
    const value = signDemoCookie(["call_a"], KEY, NOW);
    expect(verifyDemoCookie(value, KEY, NOW + COOKIE_MAX_AGE_S * 1000)).toEqual(["call_a"]);
    expect(verifyDemoCookie(value, KEY, NOW + COOKIE_MAX_AGE_S * 1000 + 1)).toEqual([]);
  });

  it("treats missing, empty and malformed values as no calls, never an error", () => {
    for (const value of [undefined, null, "", "x", "a.b", "1.2.3.4", `${NOW}.call_a.${"z".repeat(64)}`, `${NOW}.call_a.${"a".repeat(10)}`]) {
      expect(verifyDemoCookie(value, KEY, NOW)).toEqual([]);
    }
  });

  it("does not sign a value that is not an id", () => {
    const value = signDemoCookie(["call_a", "bad id.x~y"], KEY, NOW);
    expect(verifyDemoCookie(value, KEY, NOW)).toEqual(["call_a"]);
  });
});

describe("cookie headers", () => {
  it("finds one cookie among others", () => {
    expect(cookieFromHeader("a=1; overhear_demo_calls=abc.def; b=2")).toBe("abc.def");
    expect(cookieFromHeader("a=1")).toBeUndefined();
    expect(cookieFromHeader(null)).toBeUndefined();
  });

  it("sets httpOnly, SameSite=Lax, Path=/ and an hour, with Secure only on https", () => {
    const plain = setCookieHeader("v", false);
    expect(plain).toBe("overhear_demo_calls=v; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax");
    expect(setCookieHeader("v", true)).toBe(`${plain}; Secure`);
  });
});
