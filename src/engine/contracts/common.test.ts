// @vitest-environment node
// What every contract shares: the worst of several results, the gaps that touch a finding's evidence, and the
// softening of a violated finding when the record has no tool calls at all.
import { describe, expect, it } from "vitest";
import type { Finding, Gap, GapCode } from "@/report/schema";
import { GAP_CODES } from "@/report/schema";
import { ev, type ItemSpec } from "../testing/build";
import { GAP_DETAIL, GAP_TEXT } from "../wording";
import { HANGUP_GRACE_SEC, RELEVANT_GAPS, SPEAKING_WORDS_PER_SEC, callerHungUpBeforeResult, callerLeftAfter, gapsTouching, softenForMissingTools, worst } from "./common";

const turn: ItemSpec = { kind: "turn", role: "agent", text: "You're booked", startSec: 3, interrupted: null };
const call: ItemSpec = { kind: "tool_call", id: "tc_1", name: "book_appointment", args: {} };
const gap = (code: GapCode, seqs: number[]): Gap => ({ code, detail: "d", seqs });

describe("worst", () => {
  it("orders violated, unverified, passed, not_applicable", () => {
    expect(worst(["passed", "violated", "unverified"])).toBe("violated");
    expect(worst(["passed", "unverified", "not_applicable"])).toBe("unverified");
    expect(worst(["not_applicable", "passed"])).toBe("passed");
    expect(worst(["not_applicable", "not_applicable"])).toBe("not_applicable");
  });

  it("is not_applicable for nothing, and not_run never beats a result", () => {
    expect(worst([])).toBe("not_applicable");
    expect(worst(["not_run", "passed"])).toBe("passed");
  });
});

describe("gapsTouching", () => {
  it("returns the gaps that cite one of the seqs", () => {
    const e = ev([turn, call], { gaps: [gap("unknown_success", [2]), gap("evidence_conflict", [1]), gap("ambiguous_link", [5])] });
    expect(gapsTouching(e, "promise_backed", [1, 2]).map((g) => g.code)).toEqual(["unknown_success", "evidence_conflict"]);
    expect(gapsTouching(e, "promise_backed", [9])).toEqual([]);
  });

  it("a gap with no seqs touches nothing", () => {
    const e = ev([turn], { gaps: [gap("missing_tool_transcript", [])] });
    expect(gapsTouching(e, "promise_backed", [1])).toEqual([]);
  });

  it("an unresolved booking detail never touches promise_backed, and touches the contracts that compare details", () => {
    const e = ev([turn, call], { gaps: [gap("unresolved_committed_detail", [1, 2])] });
    expect(gapsTouching(e, "promise_backed", [1, 2])).toEqual([]);
    expect(gapsTouching(e, "verified_before_change", [1, 2])).toEqual([]);
    expect(gapsTouching(e, "transfer_kept", [1, 2])).toEqual([]);
    expect(gapsTouching(e, "spoken_matches_committed", [1, 2])).toHaveLength(1);
    expect(gapsTouching(e, "committed_matches_request", [1, 2])).toHaveLength(1);
  });

  it("RELEVANT_GAPS: every code but unresolved_committed_detail, except for the two that compare details", () => {
    const but = GAP_CODES.filter((c) => c !== "unresolved_committed_detail");
    expect([...RELEVANT_GAPS.promise_backed]).toEqual(but);
    expect([...RELEVANT_GAPS.verified_before_change]).toEqual(but);
    expect([...RELEVANT_GAPS.transfer_kept]).toEqual(but);
    expect([...RELEVANT_GAPS.spoken_matches_committed]).toEqual([...GAP_CODES]);
    expect([...RELEVANT_GAPS.committed_matches_request]).toEqual([...GAP_CODES]);
  });
});

describe("softenForMissingTools", () => {
  const violated: Finding = {
    result: "violated",
    text: 'At 0:03 the agent said "You\'re booked". No booking was attempted.',
    said: [1],
    did: [],
    asked: [],
    gaps: [],
    fields: [],
  };

  it("turns a violated finding into unverified, names the gap, and adds it to the evidence", () => {
    const e = ev([turn]);
    const out = softenForMissingTools(e, violated, "promise_backed");
    expect(out.result).toBe("unverified");
    expect(out.text).toBe("Couldn't check promises backed by the system: the call record has no tool calls.");
    expect(out.gaps).toEqual(["missing_tool_transcript"]);
    expect(out.said).toEqual([1]);
    expect(e.gaps).toEqual([{ code: "missing_tool_transcript", detail: GAP_DETAIL.missing_tool_transcript, seqs: [] }]);
  });

  it("does not add a second gap when the adapter already raised one", () => {
    const e = ev([turn], { gaps: [{ code: "missing_tool_transcript", detail: "from the adapter", seqs: [] }] });
    softenForMissingTools(e, violated, "promise_backed");
    expect(e.gaps).toEqual([{ code: "missing_tool_transcript", detail: "from the adapter", seqs: [] }]);
  });

  it("leaves a finding alone when the record has tool calls, or a backend action stands in for one", () => {
    const withTool = ev([call, turn]);
    expect(softenForMissingTools(withTool, violated, "promise_backed")).toBe(violated);
    expect(withTool.gaps).toEqual([]);
    const withAction = ev(
      [{ kind: "backend_action", id: null, toolCallId: null, tool: "book", args: {}, result: {}, ok: true, ts: "t", link: null }, turn],
      { tier: 2 },
    );
    expect(softenForMissingTools(withAction, violated, "promise_backed")).toBe(violated);
  });

  it("leaves passed and unverified findings alone", () => {
    const e = ev([turn]);
    const passed: Finding = { ...violated, result: "passed" };
    const unverified: Finding = { ...violated, result: "unverified", gaps: ["unknown_success"] };
    expect(softenForMissingTools(e, passed, "promise_backed")).toBe(passed);
    expect(softenForMissingTools(e, unverified, "promise_backed")).toBe(unverified);
    expect(e.gaps).toEqual([]);
  });

  it("the words come from GAP_TEXT", () => {
    expect(GAP_TEXT.missing_tool_transcript.missing).toBe("the call record has no tool calls");
  });
});

describe("callerLeftAfter", () => {
  const agent = (text: string, startSec: number | null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
  const caller = (text: string, startSec: number | null): ItemSpec => ({ kind: "turn", role: "caller", text, startSec, interrupted: null });
  // Ten words: 4 s of speech at 2.5 words a second, so the announcement ends at 14 s and the cutoff is 22 s.
  const TEN = "I am transferring you to the nurse line right now";
  const hung = (items: ItemSpec[], over: Record<string, unknown> = {}) =>
    ev(items, { callFields: { disconnection_reason: "user_hangup", duration_ms: 16000, ...over } });

  it("exports its two constants", () => {
    expect(SPEAKING_WORDS_PER_SEC).toBe(2.5);
    expect(HANGUP_GRACE_SEC).toBe(8);
  });

  it("is during when the call ended within the cutoff", () => {
    expect(callerLeftAfter(hung([agent(TEN, 10)]), 1)).toEqual({ left: "during" });
    expect(callerLeftAfter(hung([agent(TEN, 10)], { duration_ms: 22000 }), 1)).toEqual({ left: "during" });
  });

  it("is null when the caller waited past the cutoff", () => {
    expect(callerLeftAfter(hung([agent(TEN, 10)], { duration_ms: 22100 }), 1)).toBeNull();
    expect(callerLeftAfter(hung([agent(TEN, 10)], { duration_ms: 55000 }), 1)).toBeNull();
  });

  it("is null for any other end reason, or none", () => {
    for (const reason of ["agent_hangup", "call_transfer", "inactivity", "max_duration_reached", "error_llm_websocket_open"]) {
      expect(callerLeftAfter(hung([agent(TEN, 10)], { disconnection_reason: reason }), 1)).toBeNull();
    }
    expect(callerLeftAfter(ev([agent(TEN, 10)], { callFields: { duration_ms: 16000 } }), 1)).toBeNull();
  });

  it("is null when a tool call or backend action comes after", () => {
    const call: ItemSpec = { kind: "tool_call", id: "t", name: "transfer_call", args: {} };
    expect(callerLeftAfter(hung([agent(TEN, 10), call]), 1)).toBeNull();
    const action: ItemSpec = { kind: "backend_action", toolCallId: null, tool: "x", ok: true, at: null } as unknown as ItemSpec;
    expect(callerLeftAfter(hung([agent(TEN, 10), action]), 1)).toBeNull();
  });

  it("a tool call before the claim does not count", () => {
    const call: ItemSpec = { kind: "tool_call", id: "t", name: "lookup", args: {} };
    expect(callerLeftAfter(hung([call, agent(TEN, 10)]), 2)).toEqual({ left: "during" });
  });

  it("is null when the agent spoke again after a caller turn", () => {
    expect(callerLeftAfter(hung([agent(TEN, 10), caller("ok", 12), agent("Still here?", 13)]), 1)).toBeNull();
  });

  it("a streamed second agent fragment is the same announcement, and the last fragment sets the end", () => {
    // Fragment two starts at 20 s with ten words: ends at 24 s, cutoff 32 s.
    const items = [agent(TEN, 10), agent(TEN, 20)];
    expect(callerLeftAfter(hung(items, { duration_ms: 30000 }), 1)).toEqual({ left: "during" });
    expect(callerLeftAfter(hung(items, { duration_ms: 33000 }), 1)).toBeNull();
  });

  it("a caller who barged in within the cutoff and then left in silence is during", () => {
    expect(callerLeftAfter(hung([agent(TEN, 10), caller("wait, no", 12)], { duration_ms: 90000 }), 1)).toEqual({ left: "during" });
    expect(callerLeftAfter(hung([agent(TEN, 10), caller("wait, no", 22)], { duration_ms: 90000 }), 1)).toEqual({ left: "during" });
  });

  it("a caller turn past the cutoff, with a long silence, is null", () => {
    expect(callerLeftAfter(hung([agent(TEN, 10), caller("hello?", 40)], { duration_ms: 90000 }), 1)).toBeNull();
  });

  it("is untimed when the last agent turn has no start or the call no duration", () => {
    expect(callerLeftAfter(hung([agent(TEN, null)]), 1)).toEqual({ left: "untimed" });
    expect(callerLeftAfter(hung([agent(TEN, 10), agent(TEN, null)]), 1)).toEqual({ left: "untimed" });
    const noDuration = ev([agent(TEN, 10)], { callFields: { disconnection_reason: "user_hangup" } });
    expect(callerLeftAfter(noDuration, 1)).toEqual({ left: "untimed" });
  });
});

describe("callerHungUpBeforeResult", () => {
  const call: ItemSpec = { kind: "tool_call", id: "t", name: "book_appointment", args: {} };
  const caller: ItemSpec = { kind: "turn", role: "caller", text: "hello?", startSec: 5, interrupted: null };
  const event: ItemSpec = { kind: "event", type: "x", data: null };
  const withReason = (items: ItemSpec[], reason = "user_hangup") => ev(items, { callFields: { disconnection_reason: reason } });

  it("holds for user_hangup with only caller turns and events after the call", () => {
    expect(callerHungUpBeforeResult(withReason([turn, call]), 2)).toBe(true);
    expect(callerHungUpBeforeResult(withReason([turn, call, caller, event]), 2)).toBe(true);
  });

  it("through exempts the claim made over the call", () => {
    const claim = turn;
    expect(callerHungUpBeforeResult(withReason([call, claim, caller]), 1)).toBe(false);
    expect(callerHungUpBeforeResult(withReason([call, claim, caller]), 1, 2)).toBe(true);
  });

  it("fails for another reason, an agent turn, or another tool item after the call", () => {
    expect(callerHungUpBeforeResult(withReason([turn, call], "agent_hangup"), 2)).toBe(false);
    expect(callerHungUpBeforeResult(withReason([turn, call, turn]), 2)).toBe(false);
    expect(callerHungUpBeforeResult(withReason([turn, call, { ...call, id: "u" }]), 2)).toBe(false);
  });
});
