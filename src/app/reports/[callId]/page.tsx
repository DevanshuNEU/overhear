// The call detail screen. It reads one report through getReport, so the engine can replace the
// samples without this file changing. A report that does not validate is never rendered.
import { Suspense, use } from "react";
import { notFound } from "next/navigation";
import { CallReportView } from "@/components/report/CallReportView";
import { LoadingView } from "@/components/report/LoadingView";
import { UnreadableView } from "@/components/report/UnreadableView";
import { getFileReport } from "@/files/store";
import { isLocalMode } from "@/pull/local";
import { PAGE_NAME, REPORT_TITLE } from "@/report/labels";
import { echoableId } from "@/components/report/format";
import type { CallReport } from "@/report/schema";
import { SAMPLE_REPORTS } from "@/report/samples";
import { sampleReport } from "@/demo-samples";
import { getReport, readyDelay } from "@/report/store";

type Props = { params: Promise<{ callId: string }> };

// The page leads with a specific sentence, so the stored headline goes in the tab's title. The call ID comes from
// the address, so it is repeated only when it looks like an ID, the same check the not-found page makes.
export async function generateMetadata({ params }: Props) {
  const { callId } = await params;
  const found = await getReport(callId);
  const id = echoableId(callId) ?? REPORT_TITLE;
  return { title: found.status === "found" ? `${found.report.headline} - ${id} - ${PAGE_NAME}` : `${id} - ${PAGE_NAME}` };
}

/** Holds the report back until it is ready. With no wait it shows at once, so a normal load never suspends. */
function Ready({ report, wait, keep }: { report: CallReport; wait: Promise<void> | null; keep: boolean }) {
  if (wait) use(wait);
  return <CallReportView report={report} keep={keep} />;
}

// The lookup comes first and is not inside any loading boundary, so a missing call answers a real 404.
// Only after it has found the report does the page show its loading screen, in place.
export default async function ReportPage({ params }: Props) {
  const { callId } = await params;
  const found = await getReport(callId);
  if (found.status === "not_found") notFound();
  if (found.status === "unreadable") return <UnreadableView callId={found.callId} problems={found.problems} />;
  // "Keep as a test" is for a real Retell call on this computer: never the hosted demo, never one of the built-in
  // samples, and never a call read from a file (keeping one reads the call from Retell again).
  const keep = isLocalMode() && !SAMPLE_REPORTS.some((r) => r.callId === found.report.callId) && sampleReport(found.report.callId) === undefined && getFileReport(callId) === undefined;
  return (
    <Suspense fallback={<LoadingView />}>
      <Ready report={found.report} wait={readyDelay(found.report.callId)} keep={keep} />
    </Suspense>
  );
}
