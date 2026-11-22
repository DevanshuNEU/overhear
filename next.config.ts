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
  // The proxy buffers a request body so a route can read it too, and cuts it at 10 MB. Opened session report files
  // (POST /api/files) may add up to 50 MB, so the buffer is a little larger than that.
  experimental: { proxyClientMaxBodySize: "64mb" },
  // Nothing in the app uses next/image, so the optimizer is off and no remote host is allowed.
  images: { remotePatterns: [], unoptimized: true },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
