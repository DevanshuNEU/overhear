// A plain way back to the sample calls at "/". The hosted report shell uses the steps (CallSteps) instead, which also
// keep the filter; this is the bare link.
import Link from "next/link";
import { BACK_LABEL } from "@/report/labels";

export function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-report-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </svg>
      {BACK_LABEL.hosted}
    </Link>
  );
}
