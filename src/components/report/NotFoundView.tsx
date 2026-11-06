"use client";

// No report for the address. Next gives a not-found page no params, so the call id is read from the address.
import { usePathname } from "next/navigation";
import { NOT_FOUND } from "@/report/labels";
import { echoableId } from "./format";

function callIdIn(pathname: string): string | null {
  const match = /^\/reports\/([^/]+)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function NotFoundView() {
  const callId = echoableId(callIdIn(usePathname()));
  return (
    <div>
      <h1 className="max-w-[34ch] text-2xl font-semibold leading-[1.2] tracking-[-0.01em] sm:text-[28px]">{NOT_FOUND.title}</h1>
      <p className="mt-4 max-w-[62ch] break-words text-base">{NOT_FOUND.detail(callId)}</p>
      <p className="mt-2 max-w-[62ch] text-base text-report-ink-2">{NOT_FOUND.next}</p>
    </div>
  );
}
