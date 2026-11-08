// Screens for the states the three samples do not reach: an unverified result with a gap, a report that
// fails the schema, and a slow load (the wait itself is in store.ts). They are built from the samples and served only when
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

/**
 * The passed sample, with a caller who also gives a phone number the way speech to text writes it, digit by digit.
 * The sample already holds a spoken date of birth ("fourteenth of March nineteen eighty five"), so the transcript
 * shows both kinds of spoken number. Nothing else changes: every rule keeps its result.
 */
function buildSpokenNumbers(): CallReport {
  const base = renamed(passedSample, "call_demo_spoken_numbers");
  const items = base.evidence.items.map((it) =>
    it.kind === "turn" && it.seq === 35 ? { ...it, text: "Awesome. Thank you. If you need to reach me, it's five five five one two three four. " } : it,
  );
  return CallReportSchema.parse({ ...base, evidence: { ...base.evidence, items } });
}

export const spokenNumbersSample: CallReport = buildSpokenNumbers();

/** A record that fails the schema: its verdict says passed while a rule is violated. */
const unreadableRecord = { ...renamed(failedSample, "call_demo_unreadable"), verdict: "passed" };

export async function demoSource(callId: string): Promise<unknown | undefined> {
  if (callId === "call_demo_unverified") return unverifiedSample;
  if (callId === "call_demo_spoken_numbers") return spokenNumbersSample;
  if (callId === "call_demo_unreadable") return unreadableRecord;
  // Slow to become ready, not slow to find: see readyDelay in store.ts.
  if (callId === "call_demo_slow") return renamed(failedSample, "call_demo_slow");
  return undefined;
}
