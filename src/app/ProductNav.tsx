// The one shell at the top of the local screens: the call list, a call's report and the test call. The name goes
// home, and two links say where the person is. On the list the right side is the connection and Disconnect (passed
// in); everywhere else it is only a quiet note that Retell is connected.
import Link from "next/link";
import { PAGE_NAME } from "@/report/labels";
import { LIST_WORDS } from "./callListWords";
import { RUN_IT_URL, SAMPLE_WORDS } from "./sampleListWords";

export const NAV_WORDS = {
  label: "Main",
  calls: "Calls",
  testCall: "Test call",
} as const;

type Props = {
  /** Which link is the page the person is on. None on a call's report. */
  current?: "calls" | "test-call";
  /** A page inside the Calls section (a call report): Calls shows as current, but is not the page itself. */
  section?: "calls";
  /** The right side. Without it: "Connected to Retell." in muted text. */
  right?: React.ReactNode;
  /** Room below the shell, set by the screen. */
  className?: string;
  /** A hosted copy: no Test call, and on the right a note and the link to run Overhear on your own calls. */
  hosted?: boolean;
};

// Outlined, not filled: on the hosted copy the first thing a visitor does is call the demo agent (the band under the headline).
const SECONDARY_LINK =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-report-line-strong bg-report-surface px-4 text-sm font-semibold hover:bg-report-calm-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent";
const LINK = `inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium ${FOCUS}`;

export function ProductNav({ current, section, right, className = "mb-10 sm:mb-14", hosted = false }: Props) {
  const item = (id: "calls" | "test-call", href: string, label: string) => {
    const page = current === id;
    const here = page || (id === "calls" && section === "calls");
    return (
      <Link href={href} aria-current={page ? "page" : here ? "true" : undefined} className={`${LINK} ${here ? "text-report-accent" : "text-report-ink-2 hover:text-report-ink"}`}>
        {label}
      </Link>
    );
  };
  return (
    <header className={`-mt-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <div className="flex items-center gap-x-4">
          <Link href="/" className={`inline-flex min-h-11 items-center rounded-md text-sm font-semibold tracking-[-0.01em] text-report-ink-2 ${FOCUS}`}>
            {PAGE_NAME}
          </Link>
          <nav aria-label={NAV_WORDS.label} className="flex items-center gap-x-1">
            {item("calls", "/", NAV_WORDS.calls)}
            {hosted ? null : item("test-call", "/test-call", NAV_WORDS.testCall)}
          </nav>
        </div>
        {hosted ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="text-[13px] text-report-muted">{SAMPLE_WORDS.navNote}</p>
            <a href={RUN_IT_URL} className={SECONDARY_LINK}>
              {SAMPLE_WORDS.runIt}
            </a>
          </div>
        ) : (
          (right ?? <p className="text-[13px] text-report-muted">{LIST_WORDS.connected}</p>)
        )}
      </div>
    </header>
  );
}
