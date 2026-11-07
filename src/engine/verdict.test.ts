// @vitest-environment node
// The verdict (spec 6.6 and 6.8): failed when any contract is violated, needs_review when something could not be
// checked or the agent deferred, passed otherwise, with the notes and the headline that go with it.
import { describe, expect, it } from "vitest";
import { REASON_LINE, headlineFor } from "@/report/labels";
import type { ContractId, ContractResult, Detection, Finding, Gap, Result } from "@/report/schema";
import { ev, type ItemSpec } from "./testing/build";
import { verdictFor } from "./verdict";

const agent = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const call = (id: string, name: string): ItemSpec => ({ kind: "tool_call", id, name, args: {} });
const result = (id: string): ItemSpec => ({ kind: "tool_result", id, ok: null, platformOk: true, payload: {} });

// seq 1 agent (0:05), 2 tool call, 3 tool result, 4 agent (0:37), 5 agent (0:50)
const evidence = (gaps: Gap[] = []) =>
  ev([agent("Booking that now.", 5), call("tc_1", "book_appointment"), result("tc_1"), agent("Please try again, or I can help once it's back online.", 37), agent("Is there anything else?", 50)], { gaps });

const finding = (result: Finding["result"], over: Partial<Finding> = {}): Finding => ({
  result,
  text: `a ${result} finding`,
  said: [1],
  did: [2, 3],
  asked: [],
  gaps: [],
  fields: [],
  ...over,
});

function contract(id: ContractId, r: Result, findings: Finding[] = []): ContractResult {
  return { contract: id, result: r, findings };
}

const NOT_APPLICABLE: ContractResult[] = [
  contract("promise_backed", "not_applicable"),
  contract("spoken_matches_committed", "not_applicable"),
  contract("transfer_kept", "not_applicable"),
  contract("committed_matches_request", "not_run"),
];

const withResult = (id: ContractId, r: ContractResult): ContractResult[] => NOT_APPLICABLE.map((c) => (c.contract === id ? r : c));

const deferral = (seq: number, quote = "I can help once it's back online"): Detection => ({ seq, cls: "deferral", quote, source: "code" });

describe("verdictFor", () => {
  it("any violated is failed with \"The call broke a rule, and the call record shows it.\"", () => {
    const results = withResult("transfer_kept", contract("transfer_kept", "violated", [finding("violated")]));
    const v = verdictFor(results, [], evidence());
    expect(v).toEqual({ verdict: "failed", notes: [], headline: "The call broke a rule, and the call record shows it.", reasons: [] });
  });

  it("a deferral alone is needs_review with a deferral reason", () => {
    const v = verdictFor(NOT_APPLICABLE, [deferral(4)], evidence());
    expect(v.verdict).toBe("needs_review");
    expect(v.notes).toEqual([]);
    expect(v.reasons).toEqual([
      { kind: "deferral", text: 'At 0:37 the agent said "I can help once it\'s back online". It put the request off.', seqs: [4] },
    ]);
    expect(v.headline).toBe(REASON_LINE.deferral);
  });

  it("a deferral reason carries every deferral turn in seqs, once, in one reason", () => {
    const v = verdictFor(NOT_APPLICABLE, [deferral(5, "Call back later"), deferral(4), deferral(4, "once it's back online")], evidence());
    expect(v.reasons).toHaveLength(1);
    expect(v.reasons[0].seqs).toEqual([4, 5]);
    expect(v.reasons[0].text).toBe('At 0:37 the agent said "I can help once it\'s back online". At 0:50 the agent said "Call back later". It put the request off.');
  });

  it("an unverified result is needs_review with an unverified_result reason naming its contract", () => {
    const gap: Gap = { code: "unknown_success", detail: "The book_appointment result doesn't say whether it worked.", seqs: [3], tool: "book_appointment" };
    const results = withResult("promise_backed", contract("promise_backed", "unverified", [finding("unverified", { gaps: ["unknown_success"] })]));
    const v = verdictFor(results, [], evidence([gap]));
    expect(v.verdict).toBe("needs_review");
    expect(v.reasons).toEqual([{ kind: "unverified_result", contract: "promise_backed", text: gap.detail, seqs: [1, 2, 3] }]);
    expect(v.headline).toBe(REASON_LINE.unverified_result);
  });

  it("an unverified result with no gap behind it says what its finding says", () => {
    const f = finding("unverified", { text: "Couldn't check promises backed by the system: the agent never confirmed the booking." });
    const v = verdictFor(withResult("promise_backed", contract("promise_backed", "unverified", [f])), [], evidence());
    expect(v.reasons[0].text).toBe(f.text);
  });

  it("a gap with no seqs backs a finding that cites its code", () => {
    const gap: Gap = { code: "missing_tool_transcript", detail: "Retell kept the conversation but not its tool calls.", seqs: [] };
    const f = finding("unverified", { gaps: ["missing_tool_transcript"] });
    const v = verdictFor(withResult("promise_backed", contract("promise_backed", "unverified", [f])), [], evidence([gap]));
    expect(v.reasons[0].text).toBe(gap.detail);
  });

  it("a gap of another code, or one that touches other turns, is not the reason", () => {
    const other: Gap = { code: "unresolved_committed_detail", detail: "elsewhere", seqs: [5], tool: "book_appointment", field: "date" };
    const f = finding("unverified", { gaps: ["unknown_success"], text: "its own text" });
    const v = verdictFor(withResult("promise_backed", contract("promise_backed", "unverified", [f])), [], evidence([other]));
    expect(v.reasons[0].text).toBe("its own text");
  });

  it("at most one reason per kind and contract", () => {
    const gap: Gap = { code: "unknown_success", detail: "The book_appointment result doesn't say whether it worked.", seqs: [3] };
    const two = contract("promise_backed", "unverified", [finding("unverified", { gaps: ["unknown_success"] }), finding("unverified", { said: [4], gaps: ["unknown_success"] })]);
    const other = contract("transfer_kept", "unverified", [finding("unverified", { text: "second contract" })]);
    const results = NOT_APPLICABLE.map((c) => (c.contract === "promise_backed" ? two : c.contract === "transfer_kept" ? other : c));
    const v = verdictFor(results, [deferral(4), deferral(5, "later")], evidence([gap]));
    const keys = v.reasons.map((r) => `${r.kind}:${r.contract ?? ""}`);
    expect(keys).toEqual(["unverified_result:promise_backed", "unverified_result:transfer_kept", "deferral:"]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(v.reasons[0].seqs).toEqual([1, 2, 3, 4]);
  });

  it("a deferral with a violated contract is failed with no reasons", () => {
    const results = withResult("transfer_kept", contract("transfer_kept", "violated", [finding("violated")]));
    const v = verdictFor(results, [deferral(4)], evidence());
    expect(v.verdict).toBe("failed");
    expect(v.reasons).toEqual([]);
    expect(v.notes).toEqual([]);
  });

  it("a violated contract beside an unverified one is failed with no reasons", () => {
    const results = NOT_APPLICABLE.map((c) =>
      c.contract === "transfer_kept"
        ? contract("transfer_kept", "violated", [finding("violated")])
        : c.contract === "promise_backed"
          ? contract("promise_backed", "unverified", [finding("unverified")])
          : c,
    );
    const v = verdictFor(results, [], evidence());
    expect(v.verdict).toBe("failed");
    expect(v.reasons).toEqual([]);
  });

  it("all not_applicable gives passed with no_promises_made and request_not_checked", () => {
    const v = verdictFor(NOT_APPLICABLE, [], evidence());
    expect(v).toEqual({
      verdict: "passed",
      notes: ["no_promises_made", "request_not_checked"],
      headline: headlineFor("passed", ["no_promises_made", "request_not_checked"], []),
      reasons: [],
    });
    expect(v.headline).toBe("Passed. The agent made no promises. The caller's request wasn't checked.");
  });

  it("a kept promise is passed with only request_not_checked", () => {
    const results = withResult("promise_backed", contract("promise_backed", "passed", [finding("passed")]));
    const v = verdictFor(results, [], evidence());
    expect(v.verdict).toBe("passed");
    expect(v.notes).toEqual(["request_not_checked"]);
    expect(v.headline).toBe("Every promise that applied was kept. The caller's request wasn't checked.");
  });

  it("refusals and offers are not reasons", () => {
    const refusal: Detection = { seq: 4, cls: "refusal", quote: "I can't", source: "code" };
    const v = verdictFor(NOT_APPLICABLE, [refusal], evidence());
    expect(v.verdict).toBe("passed");
  });
});
