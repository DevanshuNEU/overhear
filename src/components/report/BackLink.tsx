// The way back from a call screen. In local mode that is the call list at "/", which restores its last pull from the
// browser's session, so the person lands where they left. A hosted copy has no list ("/" only redirects to the demo),
// so there it says where it really goes.
import Link from "next/link";
import { DEMO_HOME } from "@/lib/demo-paths";
import { BACK_LABEL } from "@/report/labels";

export function BackLink({ local }: { local: boolean }) {
  return (
    <Link
      href={local ? "/" : DEMO_HOME}
      className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-report-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent"
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 3.5 5.5 8l4.5 4.5" />
      </svg>
      {local ? BACK_LABEL.local : BACK_LABEL.hosted}
    </Link>
  );
}
