import type { NextConfig } from "next";

// Sent on every path. Local mode already forbids framing in src/proxy.ts with the same two values (FRAME_HEADERS in
// src/pull/local.ts), so the two never disagree.
export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "microphone=(self), camera=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Nothing in the app uses next/image, so the optimizer is off and no remote host is allowed.
  images: { remotePatterns: [], unoptimized: true },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
