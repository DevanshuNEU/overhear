// Screens for the states the three samples do not reach: an unverified result with a gap, a report that
// fails the schema, and a slow load. They are built from the samples and served only when
// OVERHEAR_DEMO_STATES=1 outside production, so a person can look at those states running. They never
// load in a real run: store.ts imports this file only when the flag is on.
import { CallReportSchema, type CallReport } from "./schema";
import { headlineFor } from "./labels";
import { failedSample, passedSample } from "./samples";

function renamed<T extends CallReport>(report: T, callId: string): T {
  return { ...structuredClone(report), callId, evidence: { ...structuredClone(report.evidence), callId } };
}

const UNVERIFIED_TEXT: Partial<Record<string, string>> = {
  promise_backed: "At 1:47 the agent said the booking was made.",
  verified_before_change: "The booking at 1:47 came after an identity check.",
  spoken_matches_committed: "The agent confirmed Friday, November 6 at 2:00 PM with Dr. Priya Nair.",
};

/** The passed sample, except the booking call returned no success field: three rules cannot be confirmed. */
function buildUnverified(): CallReport {
  const base = renamed(passedSample, "call_demo_unverified");
  const unclear = 33; // the booking call's result
  const items = base.evidence.items.map((it) => (it.seq === unclear && it.kind === "tool_result" ? { ...it, ok: null, platformOk: null } : it));
  const detail = "The booking call returned no success field, so the booking can't be confirmed.";
  const results = base.results.map((c) => {
    if (!c.findings.some((f) => f.did.includes(unclear))) return c;
    return {
      ...c,
      result: "unverified" as const,
      findings: c.findings.map((f) => ({ ...f, result: "unverified" as const, gaps: ["unknown_success" as const], text: `${UNVERIFIED_TEXT[c.contract] ?? ""} ${detail}`.trim() })),
    };
  });
  const reasons = results
    .filter((c) => c.result === "unverified")
    .map((c) => ({ kind: "unverified_result" as const, contract: c.contract, text: detail, seqs: [unclear] }));
  return CallReportSchema.parse({
    ...base,
    verdict: "needs_review",
    notes: [],
    reasons,
    headline: headlineFor("needs_review", [], reasons),
    results,
    evidence: { ...base.evidence, items, gaps: [{ code: "unknown_success", detail, seqs: [unclear], tool: "book_appointment" }] },
  });
}

export const unverifiedSample: CallReport = buildUnverified();

/** A record that fails the schema: its verdict says passed while a rule is violated. */
const unreadableRecord = { ...renamed(failedSample, "call_demo_unreadable"), verdict: "passed" };

export async function demoSource(callId: string): Promise<unknown | undefined> {
  if (callId === "call_demo_unverified") return unverifiedSample;
  if (callId === "call_demo_unreadable") return unreadableRecord;
  if (callId === "call_demo_slow") {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    return renamed(failedSample, "call_demo_slow");
  }
  return undefined;
}
