import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "./next.config";
import { FRAME_HEADERS } from "@/pull/local";

describe("next.config", () => {
  afterEach(() => vi.unstubAllEnvs());

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
      "strict-transport-security": "max-age=31536000; includeSubDomains",
    });
  });

  it("sends no Strict-Transport-Security in local mode, which is http on 127.0.0.1", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    const rules = await nextConfig.headers!();
    expect(rules[0].headers.map((h) => h.key.toLowerCase())).not.toContain("strict-transport-security");
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
