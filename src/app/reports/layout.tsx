// The shell for the call report screens: a light surface of its own (tokens in globals.css under
// .report), a skip link, and one landmark for the content.
import { BackLink } from "@/components/report/BackLink";
import { isLocalMode } from "@/pull/local";
import { PAGE_NAME, SKIP_TO_CONTENT_LABEL } from "@/report/labels";

// The back link depends on local mode, which is read from the environment, so no build may bake it in.
export const dynamic = "force-dynamic";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="report min-h-screen bg-report-canvas font-sans text-report-ink">
      <a
        href="#call"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-report-surface focus:px-3 focus:py-2 focus:text-sm focus:outline-2 focus:outline-report-accent"
      >
        {SKIP_TO_CONTENT_LABEL}
      </a>
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-6">
        {/* The row is 44 px tall for the link's touch target; the negative top margin keeps the name where it was. */}
        <div className="-mt-3 mb-7 flex items-center gap-4 sm:mb-11">
          <p className="text-sm font-semibold tracking-[-0.01em] text-report-ink-2">{PAGE_NAME}</p>
          <BackLink local={isLocalMode()} />
        </div>
        <main id="call" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
