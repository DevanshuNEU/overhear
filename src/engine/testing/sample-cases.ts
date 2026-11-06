// The three scrubbed samples as eval cases: the seed of eval/engine/cases/. Test-only. Each record is the
// sample's evidence written back as a Retell get-call record (toRetell), and each expectation is what the M1
// engine should say (m1View), so the cases cannot drift from the samples: a test compares the committed files
// with this, and `npm run eval:engine -- --write-sample-cases` rewrites them.
//
// One rule applies to all three: M1 has no request source, so committed_matches_request is expected not_run.
// One sample is overridden: the needs-review call needs review only because a model found an unanswered request.
// Without a request source, M1's honest verdict for it is passed (with no_promises_made and request_not_checked).
// When M2 adds request sources, that case is updated to needs_review in the same pull request.
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import type { CallReport, ContractId, Result, Verdict } from "@/report/schema";
import { CASE_SCHEMA_VERSION, type EvalCase } from "../eval/case";
import { m1View } from "./build";
import { toRetell } from "./retell";

/** When the samples were turned into cases. Fixed, so regenerating the files changes nothing. */
export const SAMPLE_LABEL_DATE = "2026-11-06";

function sampleCase(id: string, sample: CallReport, note: string, verdict?: Verdict): EvalCase {
  const view = m1View(sample);
  const contracts: Partial<Record<ContractId, Result>> = {};
  for (const r of view.results) contracts[r.contract] = r.contract === "committed_matches_request" ? "not_run" : r.result;

  const mustCite = view.results
    .filter((r) => r.result === "violated")
    .map((r) => ({ contract: r.contract, seqs: [...new Set(r.findings.flatMap((f) => f.said))].sort((a, b) => a - b) }));

  return {
    schemaVersion: CASE_SCHEMA_VERSION,
    id,
    source: "real",
    independent: false,
    platform: "retell",
    locked: true,
    label: { by: "sample", at: SAMPLE_LABEL_DATE, note },
    expect: { verdict: verdict ?? view.verdict, contracts, ...(mustCite.length > 0 ? { mustCite } : {}) },
    record: toRetell(sample.evidence) as Record<string, unknown>,
  };
}

/** The three sample cases, in id order. */
export function sampleCases(): EvalCase[] {
  return [
    sampleCase(
      "sample-failed",
      failedSample,
      "Scrubbed demo call, from the failed sample report under the M1 scheduling pack. The agent said twice that it was transferring the caller to a nurse, and no transfer was attempted.",
    ),
    sampleCase(
      "sample-needs-review",
      needsReviewSample,
      "Scrubbed demo call, from the needs-review sample report. The sample needs review only because a model found an unanswered request. M1 has no request source, so it expects passed with request_not_checked. Change this to needs_review when request sources land.",
      "passed",
    ),
    sampleCase(
      "sample-passed",
      passedSample,
      "Scrubbed demo call, from the passed sample report under the M1 scheduling pack. The booking succeeded before the agent confirmed it, and the spoken details match.",
    ),
  ];
}
