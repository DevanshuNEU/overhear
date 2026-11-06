// The call detail screen. It reads one report through getReport, so the engine can replace the
// samples without this file changing. A report that does not validate is never rendered.
import { notFound } from "next/navigation";
import { CallReportView } from "@/components/report/CallReportView";
import { UnreadableView } from "@/components/report/UnreadableView";
import { PAGE_NAME } from "@/report/labels";
import { getReport } from "@/report/store";

type Props = { params: Promise<{ callId: string }> };

export async function generateMetadata({ params }: Props) {
  const { callId } = await params;
  return { title: `${callId} - ${PAGE_NAME}` };
}

export default async function ReportPage({ params }: Props) {
  const { callId } = await params;
  const found = await getReport(callId);
  if (found.status === "not_found") notFound();
  if (found.status === "unreadable") return <UnreadableView callId={found.callId} problems={found.problems} />;
  return <CallReportView report={found.report} />;
}
