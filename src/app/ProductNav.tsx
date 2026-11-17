// The one shell at the top of the local screens: the call list, a call's report and the test call. The name goes
// home, and two links say where the person is. On the list the right side is the connection and Disconnect (passed
// in); everywhere else it is only a quiet note that Retell is connected.
import Link from "next/link";
import { PAGE_NAME } from "@/report/labels";
import { LIST_WORDS } from "./callListWords";

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
};

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent";
const LINK = `inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium ${FOCUS}`;

export function ProductNav({ current, section, right, className = "mb-10 sm:mb-14" }: Props) {
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
            {item("test-call", "/test-call", NAV_WORDS.testCall)}
          </nav>
        </div>
        {right ?? <p className="text-[13px] text-report-muted">{LIST_WORDS.connected}</p>}
      </div>
    </header>
  );
}
