// Hand-built variants of the failed sample for tests. Each one is schema-valid: it goes through CallReportSchema,
// so a test that uses it shows what a real report from the engine could make the screen say. Tests only.
import { CallReportSchema, type CallReport } from "../schema";
import failed from "./failed.json";

/** The parts of a raw report a variant changes. The schema checks the rest. */
type Raw = {
  evidence: { items: unknown[]; gaps: unknown[]; tier: number; ordering: string };
  results: { contract: string; result: string; findings: { result: string; text: string; gaps: string[] }[] }[];
};

function variant(change: (r: Raw) => void): CallReport {
  const r = structuredClone(failed) as unknown as Raw;
  change(r);
  return CallReportSchema.parse(r);
}

/** A transfer_call tool call and its result after 2:22, a tool the policy does not name. The engine still finds no transfer. */
export const unnamedTransferAfter = variant((r) => {
  const n = r.evidence.items.length;
  r.evidence.items.push(
    { kind: "tool_call", seq: n + 1, id: "tc_09", name: "transfer_call", args: { to: "nurse" } },
    { kind: "tool_result", seq: n + 2, id: "tc_09", ok: true, platformOk: true, payload: { ok: true } },
  );
});

/** The platform gave no sequence, so the items are ordered by their timestamps. */
export const timestampOrdered = variant((r) => {
  r.evidence.ordering = "timestamps";
});

/** A backend log holds a transfer_call action that matches no tool call. */
export const unlinkedTransferAction = variant((r) => {
  const seq = r.evidence.items.length + 1;
  r.evidence.tier = 2;
  r.evidence.items.push({
    kind: "backend_action", seq, id: "ae_9", toolCallId: null, tool: "transfer_call", args: {}, result: { ok: true }, ok: true, ts: "2026-09-21T15:02:30Z", link: null,
  });
  r.evidence.gaps.push({ code: "unlinked_backend_action", detail: "A transfer_call action in the backend log matches no tool call.", seqs: [seq], tool: "transfer_call" });
});

/** The booking's result arrives before its call (seqs 22 and 24 swapped), which only timestamp order allows. */
export const resultBeforeCall = variant((r) => {
  r.evidence.ordering = "timestamps";
  const items = r.evidence.items as { seq: number }[];
  const [a, b] = [items[21], items[23]];
  items[21] = { ...b, seq: 22 };
  items[23] = { ...a, seq: 24 };
});

/** The promise at 2:01 is broken as well: the booking call before it does not back it for the engine. */
export const brokenPromise = variant((r) => {
  const c = r.results.find((x) => x.contract === "promise_backed")!;
  c.result = "violated";
  c.findings[0].result = "violated";
  c.findings[0].text = "At 2:01 the agent said \"Your appointment with Dr. Nair is confirmed for September 24th at 9:00 AM\". Nothing in the call backs it.";
});

/**
 * Two findings on one turn with different results: the transfer at 2:01 broke, and the promise in the same turn
 * could not be checked because the model and the rules disagree on it.
 */
export const mixedResultsOnOneTurn = variant((r) => {
  const c = r.results.find((x) => x.contract === "promise_backed")!;
  c.result = "unverified";
  c.findings[0].result = "unverified";
  c.findings[0].gaps = ["llm_code_disagreement"];
  r.evidence.gaps.push({ code: "llm_code_disagreement", detail: "The model and the rules disagree on the promise at 2:01.", seqs: [25] });
});

/** A backend action linked to the booking call that names a tool the transcript never called. */
export const untranscribedAction = variant((r) => {
  r.evidence.tier = 2;
  r.evidence.items.push({
    kind: "backend_action", seq: r.evidence.items.length + 1, id: "ae_8", toolCallId: "tc_03", tool: "cancel_appointment", args: {}, result: { ok: true }, ok: true,
    ts: "2026-09-21T15:02:40Z", link: { toolCallId: "tc_03", by: "tool_call_id" },
  });
});

export const ABSENCE_VARIANTS ={ unnamedTransferAfter, timestampOrdered, unlinkedTransferAction };
