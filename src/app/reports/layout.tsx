// The shell for the call report screens: a light surface of its own (tokens in globals.css under
// .report), a skip link, and one landmark for the content.
import { PAGE_NAME, SKIP_TO_CONTENT_LABEL } from "@/report/labels";

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
        <p className="mb-10 text-sm font-semibold tracking-[-0.01em] text-report-ink-2 sm:mb-14">{PAGE_NAME}</p>
        <main id="call" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
