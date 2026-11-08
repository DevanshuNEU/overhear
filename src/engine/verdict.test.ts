// @vitest-environment node
// The verdict (spec 6.6 and 6.8): failed when any contract is violated, needs_review when something could not be
// checked or the agent deferred, passed otherwise, with the notes and the headline that go with it.
import { describe, expect, it } from "vitest";
import { REASON_LINE, headlineFor } from "@/report/labels";
import type { ContractId, ContractResult, Detection, Finding, Gap, Result } from "@/report/schema";
import { ev, type ItemSpec } from "./testing/build";
import { NOTHING_DONE_MAX_CALLER_WORDS, verdictFor } from "./verdict";

const agent = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const caller = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "caller", text, startSec, interrupted: null });
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

describe("verdictFor: Nothing done", () => {
  const GREETING = "Hello, this is Riley at Northwind Family Clinic. How may I help you today?";
  const DEFERRAL_QUOTE = "I can help once it's back online";
  const NOTHING_DONE = { verdict: "nothing_done", notes: [], reasons: [], headline: headlineFor("nothing_done", [], []) };
  /** The 21-second shape: the caller says hello, the agent greets, and then silence. */
  const short = () => ev([agent(GREETING, 0), caller("Hello!", 4), caller("Hey, what's up.", 6), agent("Hi, how can I help?", 8)]);

  it("the word limit is 10", () => {
    expect(NOTHING_DONE_MAX_CALLER_WORDS).toBe(10);
  });

  it("the 21-second shape is nothing_done, with no notes and no reasons", () => {
    const v = verdictFor(NOT_APPLICABLE, [], short());
    expect(v).toEqual(NOTHING_DONE);
    expect(v.headline).toBe("Nothing done. The caller said almost nothing, and the agent took no action.");
  });

  it("a caller who says \"Sorry, wrong number\" is nothing_done", () => {
    expect(verdictFor(NOT_APPLICABLE, [], ev([agent(GREETING, 0), caller("Sorry, wrong number.", 4)]))).toEqual(NOTHING_DONE);
  });

  it("a call with no caller turns counts as 0 words and is nothing_done", () => {
    expect(verdictFor(NOT_APPLICABLE, [], ev([agent(GREETING, 0)]))).toEqual(NOTHING_DONE);
  });

  it("counts words split on whitespace after trimming: exactly 10 qualifies, 11 does not", () => {
    const ten = "  one two three\nfour  five six seven eight nine ten  ";
    expect(verdictFor(NOT_APPLICABLE, [], ev([caller(ten)])).verdict).toBe("nothing_done");
    expect(verdictFor(NOT_APPLICABLE, [], ev([caller("one two three four five"), caller("six seven eight nine ten eleven")])).verdict).toBe("passed");
  });

  it("an empty caller turn adds no words", () => {
    expect(verdictFor(NOT_APPLICABLE, [], ev([caller("   "), caller("Hello!")])).verdict).toBe("nothing_done");
  });

  it("the same short call with one lookup tool call is passed", () => {
    const withLookup = ev([agent(GREETING, 0), caller("Hello!", 4), call("tc_1", "check_availability"), result("tc_1")]);
    expect(verdictFor(NOT_APPLICABLE, [], withLookup).verdict).toBe("passed");
  });

  it("a backend action alone keeps a short call from nothing_done", () => {
    const action: ItemSpec = { kind: "backend_action", id: null, toolCallId: null, tool: "lookup", args: {}, result: null, ok: true, ts: "2026-11-06T14:00:00Z", link: null };
    expect(verdictFor(NOT_APPLICABLE, [], ev([caller("Hello!", 1), action])).verdict).toBe("passed");
  });

  it("a caller who asks a full question about opening hours and gets an answer is passed with no_promises_made", () => {
    const e = ev([agent(GREETING, 0), caller("What time do you open on Saturday mornings, and when do you close?", 4), agent("We open at 8 a.m. and close at noon.", 9)]);
    const v = verdictFor(NOT_APPLICABLE, [], e);
    expect(v.verdict).toBe("passed");
    expect(v.notes).toEqual(["no_promises_made", "request_not_checked"]);
  });

  it("a short call with a refusal is passed", () => {
    const refusal: Detection = { seq: 2, cls: "refusal", quote: "I can't", source: "code" };
    expect(verdictFor(NOT_APPLICABLE, [refusal], ev([agent(GREETING, 0), agent("I can't help with that.", 5)])).verdict).toBe("passed");
  });

  it.each(["completion", "transfer"] as const)("a short call with a %s detection is passed", (cls) => {
    const d: Detection = { seq: 2, cls, quote: "done", source: "code" };
    expect(verdictFor(NOT_APPLICABLE, [d], ev([caller("Hello!", 1), agent("All done.", 5)])).verdict).toBe("passed");
  });

  it("a short call with a deferral stays needs_review", () => {
    const e = ev([caller("Hello!", 1), agent(`Sorry. ${DEFERRAL_QUOTE}.`, 5)]);
    expect(verdictFor(NOT_APPLICABLE, [deferral(2, DEFERRAL_QUOTE)], e).verdict).toBe("needs_review");
  });

  it("a short call whose tool calls cannot be seen (ordering none) is passed, not nothing_done", () => {
    expect(verdictFor(NOT_APPLICABLE, [], ev([caller("Hello!", 1), agent(GREETING, 0)], { ordering: "none" })).verdict).toBe("passed");
  });

  it("a short call with a missing_tool_transcript gap is passed, not nothing_done", () => {
    const gap: Gap = { code: "missing_tool_transcript", detail: "Retell kept the conversation but not its tool calls.", seqs: [] };
    expect(verdictFor(NOT_APPLICABLE, [], ev([caller("Hello!", 1), agent(GREETING, 0)], { gaps: [gap] })).verdict).toBe("passed");
  });

  it("a call where no contract ran is not nothing_done", () => {
    const notRun = NOT_APPLICABLE.map((c) => contract(c.contract, "not_run"));
    expect(verdictFor(notRun, [], short()).verdict).toBe("passed");
  });

  // Accepted cost of the 10-word rule: a short real question answered with no tool reads nothing_done today. The
  // label is neutral and the harm low, so it stays until real test calls say where the limit belongs.
  it("a short real question answered without tools reads nothing_done today", () => {
    const e = ev([agent(GREETING, 0), caller("What are your hours?", 4), agent("We are open eight to five on weekdays.", 8)]);
    expect(verdictFor(NOT_APPLICABLE, [], e).verdict).toBe("nothing_done");
  });

  it("a short call with a violated or unverified contract keeps that verdict", () => {
    const violated = withResult("transfer_kept", contract("transfer_kept", "violated", [finding("violated")]));
    expect(verdictFor(violated, [], short()).verdict).toBe("failed");
    const unverified = withResult("promise_backed", contract("promise_backed", "unverified", [finding("unverified")]));
    expect(verdictFor(unverified, [], short()).verdict).toBe("needs_review");
  });

  it("a short call where a contract ran and passed is passed, not nothing_done", () => {
    const kept = withResult("promise_backed", contract("promise_backed", "passed", [finding("passed")]));
    expect(verdictFor(kept, [], short()).verdict).toBe("passed");
  });
});
