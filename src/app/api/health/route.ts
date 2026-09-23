import { NextResponse } from "next/server";

// Excluded from the shared-password gate (see src/proxy.ts) and reads
// nothing sensitive, so Railway's health check can hit it unauthenticated.
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
