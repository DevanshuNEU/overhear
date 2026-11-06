// The call detail screen. It reads one report through getReport, so the engine can replace the
// samples without this file changing. States other than a readable report arrive with OVE-17.
import { notFound } from "next/navigation";
import { CallReportView } from "@/components/report/CallReportView";
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
  if (found.status !== "found") notFound();
  return <CallReportView report={found.report} />;
}
