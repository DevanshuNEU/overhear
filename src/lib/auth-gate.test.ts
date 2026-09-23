import { describe, it, expect } from "vitest";
import { checkBasicAuth, isExcludedPath } from "./auth-gate";

function basicHeader(user: string, pass: string): string {
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

describe("checkBasicAuth", () => {
  it("accepts any username when the password matches", () => {
    expect(checkBasicAuth(basicHeader("anyone", "secret"), "secret")).toBe(true);
    expect(checkBasicAuth(basicHeader("other", "secret"), "secret")).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(checkBasicAuth(basicHeader("anyone", "wrong"), "secret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(checkBasicAuth(null, "secret")).toBe(false);
  });

  it("rejects a non-Basic header", () => {
    expect(checkBasicAuth("Bearer token", "secret")).toBe(false);
  });

  it("rejects malformed base64", () => {
    expect(checkBasicAuth("Basic not-base64!!!", "secret")).toBe(false);
  });
});

describe("isExcludedPath", () => {
  it("excludes retell tool and webhook routes", () => {
    expect(isExcludedPath("/api/tools/check-availability")).toBe(true);
    expect(isExcludedPath("/api/webhooks/retell")).toBe(true);
  });

  it("excludes the health check and Next internals", () => {
    expect(isExcludedPath("/api/health")).toBe(true);
    expect(isExcludedPath("/_next/static/chunk.js")).toBe(true);
    expect(isExcludedPath("/favicon.ico")).toBe(true);
  });

  it("does not exclude the dashboard or web-call routes", () => {
    expect(isExcludedPath("/")).toBe(false);
    expect(isExcludedPath("/calls/123")).toBe(false);
    expect(isExcludedPath("/api/web-call")).toBe(false);
  });
});
