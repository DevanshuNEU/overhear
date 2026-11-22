import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { RETELL_API_KEY: "key_test_secret" } }));

import { GET } from "./route";
import { cookieFromHeader } from "@/demo-call/cookie";
import { OWNER_COOKIE, verifyOwnerCookie } from "@/demo-call/owner";

const get = (url: string, authorization?: string) => GET(new Request(url, { headers: authorization ? { authorization } : {} }));
const GOOD = `Basic ${btoa("me:secret")}`;

beforeEach(() => {
  vi.stubEnv("OVERHEAR_LOCAL", "");
  vi.stubEnv("DASHBOARD_PASSWORD", "secret");
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /owner", () => {
  it("sets the owner cookie and sends the browser to /", async () => {
    const res = get("https://demo.example/owner", GOOD);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const header = res.headers.get("set-cookie") ?? "";
    expect(header).toMatch(/; Max-Age=43200; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
    expect(verifyOwnerCookie(cookieFromHeader(header, OWNER_COOKIE), "key_test_secret")).toBe(true);
  });

  it("leaves Secure off over plain http", () => {
    expect(get("http://127.0.0.1:3377/owner", GOOD).headers.get("set-cookie")).not.toContain("Secure");
  });

  it("checks the password itself, in case the proxy was bypassed", () => {
    expect(get("https://demo.example/owner").status).toBe(401);
    expect(get("https://demo.example/owner", `Basic ${btoa("me:nope")}`).headers.get("set-cookie")).toBeNull();
  });

  it("does not exist with no password", () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    const res = get("https://demo.example/owner", GOOD);
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not exist on a local copy", () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    expect(get("http://127.0.0.1:3000/owner", GOOD).status).toBe(404);
  });
});
