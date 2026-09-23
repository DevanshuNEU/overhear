"use client";

// AutoRefresh - keeps a server-rendered page current without a full reload.
// The dashboard is force-dynamic, so router.refresh() re-runs the server
// component and swaps in fresh data (a call that just finished scoring, a new
// "processing" row) while preserving client state. Renders nothing itself.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
