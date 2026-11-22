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
  // The proxy buffers a request body so a route can read it too. Opened session report files (POST /api/files, local mode
  // only) may add up to 50 MB, so a local copy buffers a little more than that. A hosted copy takes no large body at all,
  // and buffering 64 MB per request there would let a few uploads exhaust its memory, so it stays at 1 MB.
  experimental: { proxyClientMaxBodySize: process.env.OVERHEAR_LOCAL === "1" ? "64mb" : "1mb" },
  // Nothing in the app uses next/image, so the optimizer is off and no remote host is allowed.
  images: { remotePatterns: [], unoptimized: true },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
