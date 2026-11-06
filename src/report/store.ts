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

const DEMO_STATES_FLAG = "OVERHEAR_DEMO_STATES";

/**
 * The samples, plus the demo states when OVERHEAR_DEMO_STATES=1 outside production. Read on every call, so a
 * test can turn it on. The demo fixtures load only then, so a fault in them cannot reach a real run.
 */
const defaultSource: ReportSource = async (callId) => {
  const sample = await sampleSource(callId);
  if (sample !== undefined || process.env[DEMO_STATES_FLAG] !== "1" || process.env.NODE_ENV === "production") return sample;
  const { demoSource } = await import("./demo-states");
  return demoSource(callId);
};

export async function getReport(callId: string, source: ReportSource = defaultSource): Promise<ReportLookup> {
  const record = await source(callId);
  if (record === undefined) return { status: "not_found", callId };
  const parsed = CallReportSchema.safeParse(record);
  if (parsed.success) return { status: "found", report: parsed.data };
  const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "report"}: ${i.message}`);
  return { status: "unreadable", callId, problems };
}
