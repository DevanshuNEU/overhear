// The call detail screen. It reads one report through getReport, so the engine can replace the
// samples without this file changing. A report that does not validate is never rendered.
import { Suspense, use } from "react";
import { notFound } from "next/navigation";
import { CallReportView } from "@/components/report/CallReportView";
import { LoadingView } from "@/components/report/LoadingView";
import { UnreadableView } from "@/components/report/UnreadableView";
import { PAGE_NAME } from "@/report/labels";
import type { CallReport } from "@/report/schema";
import { getReport, readyDelay } from "@/report/store";

type Props = { params: Promise<{ callId: string }> };

// The page leads with a specific sentence, so the stored headline goes in the tab's title.
export async function generateMetadata({ params }: Props) {
  const { callId } = await params;
  const found = await getReport(callId);
  return { title: found.status === "found" ? `${found.report.headline} - ${callId} - ${PAGE_NAME}` : `${callId} - ${PAGE_NAME}` };
}

/** Holds the report back until it is ready. With no wait it shows at once, so a normal load never suspends. */
function Ready({ report, wait }: { report: CallReport; wait: Promise<void> | null }) {
  if (wait) use(wait);
  return <CallReportView report={report} />;
}

// The lookup comes first and is not inside any loading boundary, so a missing call answers a real 404.
// Only after it has found the report does the page show its loading screen, in place.
export default async function ReportPage({ params }: Props) {
  const { callId } = await params;
  const found = await getReport(callId);
  if (found.status === "not_found") notFound();
  if (found.status === "unreadable") return <UnreadableView callId={found.callId} problems={found.problems} />;
  return (
    <Suspense fallback={<LoadingView />}>
      <Ready report={found.report} wait={readyDelay(found.report.callId)} />
    </Suspense>
  );
}
