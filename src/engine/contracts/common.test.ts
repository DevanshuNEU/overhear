// @vitest-environment node
// What every contract shares: the worst of several results, the gaps that touch a finding's evidence, and the
// softening of a violated finding when the record has no tool calls at all.
import { describe, expect, it } from "vitest";
import type { Finding, Gap, GapCode } from "@/report/schema";
import { GAP_CODES } from "@/report/schema";
import { ev, type ItemSpec } from "../testing/build";
import { GAP_DETAIL, GAP_TEXT } from "../wording";
import { RELEVANT_GAPS, gapsTouching, softenForMissingTools, worst } from "./common";

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
