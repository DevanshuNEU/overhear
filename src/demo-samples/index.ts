// The sample calls a hosted copy shows at `/`: real eval cases, run through the engine when the first request needs
// them and kept for the life of the process. The cases are the ones `npm run eval:engine` runs, so the demo shows
// exactly what the evals check. The JSON is imported, so it is bundled and nothing is read from disk at request time.
import type { Analyze } from "@/engine/types";
import { analyzeRetellCall } from "@/engine/analyze";
import { DEFAULT_TZ } from "@/engine/eval/run";
import { rowFor, type PullRow } from "@/pull/pull";
import { toMeta } from "@/pull/retell-source";
import { CallReportSchema, type CallReport } from "@/report/schema";
import sampleFailed from "../../eval/engine/cases/sample-failed.json";
import mutBookingResultFailed from "../../eval/engine/cases/mut-booking-result-failed.json";
import mutSpokenTimeOneHourOff from "../../eval/engine/cases/mut-spoken-time-one-hour-off.json";
import mutTransferKeptAsking from "../../eval/engine/cases/mut-transfer-claim-caller-kept-asking-then-left.json";
import sampleNeedsReview from "../../eval/engine/cases/sample-needs-review.json";
import mutTransferHungUpDuring from "../../eval/engine/cases/mut-transfer-claim-caller-hung-up-during.json";
import samplePassed from "../../eval/engine/cases/sample-passed.json";
import mutTransferAddedAndWorked from "../../eval/engine/cases/mut-transfer-added-and-worked.json";
import mutShortEmptyCall from "../../eval/engine/cases/mut-short-empty-call.json";

type SampleCase = { id: string; tz?: string; record: Record<string, unknown>; expect: { verdict: string } };

/** The sample cases in the order the list shows them. Every id the brief names exists on this branch. */
export const SAMPLE_CASES: readonly SampleCase[] = [
  sampleFailed,
  mutBookingResultFailed,
  mutSpokenTimeOneHourOff,
  mutTransferKeptAsking,
  sampleNeedsReview,
  mutTransferHungUpDuring,
  samplePassed,
  mutTransferAddedAndWorked,
  mutShortEmptyCall,
] as SampleCase[];

export type DemoSample = { id: string; report: CallReport; row: PullRow };

/** One case through the engine, the same call the eval runner makes (the case's time zone, else UTC). */
export function checkSample(c: SampleCase, analyze: Analyze = analyzeRetellCall): DemoSample {
  const out = analyze(c.record, { tz: c.tz ?? DEFAULT_TZ });
  if (out.kind !== "report") throw new Error(`sample ${c.id} did not produce a report (${out.kind})`);
  const report = CallReportSchema.parse(out.report);
  const meta = toMeta(c.record);
  if (meta === null) throw new Error(`sample ${c.id} has no call id`);
  return { id: c.id, report, row: rowFor(meta, { kind: "report", report }) };
}

let cache: DemoSample[] | undefined;

/** Every sample, checked once per server process. */
export function demoSamples(): DemoSample[] {
  cache ??= SAMPLE_CASES.map((c) => checkSample(c));
  return cache;
}

/** The sample rows, in the order the cases are listed. */
export const sampleRows = (): PullRow[] => demoSamples().map((s) => s.row);

/** The sample report for a call id, or undefined when the id is not a sample. */
export function sampleReport(callId: string): CallReport | undefined {
  return demoSamples().find((s) => s.report.callId === callId)?.report;
}
