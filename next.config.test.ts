import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";
import { FRAME_HEADERS } from "@/pull/local";

describe("next.config", () => {
  it("hides the framework header", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it("sends the security headers on every path", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/(.*)");
    const sent = Object.fromEntries(rules[0].headers.map((h) => [h.key.toLowerCase(), h.value]));
    expect(sent).toEqual({
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "microphone=(self), camera=(), geolocation=()",
    });
  });

  it("agrees with the framing headers local mode adds, so the two never conflict", async () => {
    const rules = await nextConfig.headers!();
    const sent = Object.fromEntries(rules[0].headers.map((h) => [h.key.toLowerCase(), h.value]));
    for (const [name, value] of Object.entries(FRAME_HEADERS)) expect(sent[name]).toBe(value);
  });

  it("lets the image optimizer fetch no remote URL", () => {
    expect(nextConfig.images?.remotePatterns).toEqual([]);
    expect(nextConfig.images?.unoptimized).toBe(true);
  });
});
