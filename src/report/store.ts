// The one place the dashboard gets a call report from. Until the engine exists it reads the three
// samples; the engine replaces `sampleSource` and nothing else changes. Whatever a source returns is
// checked against the schema here, so a report that does not validate never reaches a screen.
import { CallReportSchema, type CallReport } from "./schema";
import { SAMPLE_REPORTS } from "./samples";

export type ReportLookup =
  | { status: "found"; report: CallReport }
  | { status: "not_found"; callId: string }
  | { status: "unreadable"; callId: string; problems: string[] };

/** Returns the stored record for a call id, or undefined when there is none. The record is unchecked. */
export type ReportSource = (callId: string) => Promise<unknown | undefined>;

export const sampleSource: ReportSource = async (callId) => SAMPLE_REPORTS.find((r) => r.callId === callId);

export async function getReport(callId: string, source: ReportSource = sampleSource): Promise<ReportLookup> {
  const record = await source(callId);
  if (record === undefined) return { status: "not_found", callId };
  const parsed = CallReportSchema.safeParse(record);
  if (parsed.success) return { status: "found", report: parsed.data };
  const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "report"}: ${i.message}`);
  return { status: "unreadable", callId, problems };
}
