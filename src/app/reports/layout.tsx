// The shell for the call report screens: a light surface of its own (tokens in globals.css under
// .report), a skip link, and one landmark for the content. A local copy has the product navigation and the steps
// along the call list. A hosted copy has the hosted navigation and the steps along the sample calls.
import { navView } from "@/app/navView";
import { ProductNav } from "@/app/ProductNav";
import { CallSteps } from "@/components/report/CallSteps";
import { yourDemoCallIds } from "@/demo-call/report-source";
import { sampleRows } from "@/demo-samples";
import { isLocalMode } from "@/pull/local";
import { SKIP_TO_CONTENT_LABEL } from "@/report/labels";

// The shell depends on local mode, which is read from the environment, so no build may bake it in.
export const dynamic = "force-dynamic";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const local = isLocalMode();
  const yourCalls = local ? [] : await yourDemoCallIds();
  const view = local ? await navView() : "retell";
  return (
    <div className="report min-h-screen bg-report-canvas font-sans text-report-ink">
      <a
        href="#call"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded-md focus:bg-report-surface focus:px-3 focus:py-2 focus:text-sm focus:outline-2 focus:outline-report-accent"
      >
        {SKIP_TO_CONTENT_LABEL}
      </a>
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-6">
        {local ? (
          <>
            <ProductNav section="calls" view={view} className="mb-2 sm:mb-3" />
            <CallSteps />
          </>
        ) : (
          <>
            <ProductNav section="calls" hosted className="mb-2 sm:mb-3" />
            <CallSteps samples={sampleRows()} yourCalls={yourCalls} />
          </>
        )}
        <main id="call" tabIndex={-1} className="outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
