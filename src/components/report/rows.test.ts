import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample } from "@/report/samples";
import { resultBeforeCall } from "@/report/samples/variants.fixture";
import { timelineRows } from "./rows";

describe("timelineRows", () => {
  it("groups adjacent turns by one speaker, and keeps every seq", () => {
    const rows = timelineRows(failedSample.evidence);
    const callers = rows.find((r) => r.kind === "speech" && r.turns[0].seq === 2)!;
    expect(callers.kind === "speech" && callers.turns.map((t) => t.seq)).toEqual([2, 3, 4]);
    expect(callers.seqs).toEqual([2, 3, 4]);
    // Every seq of the evidence is in exactly one row.
    const all = rows.flatMap((r) => r.seqs).sort((a, b) => a - b);
    expect(all).toEqual(failedSample.evidence.items.map((i) => i.seq));
  });

  it("makes one row of a tool call and its result, standing for both seqs", () => {
    const rows = timelineRows(needsReviewSample.evidence);
    const action = rows.find((r) => r.kind === "action" && r.seqs.includes(7))!;
    expect(action.seqs).toEqual([7, 9]);
    expect(action.kind === "action" && action.entry.line).toBe("check_availability failed");
    expect(rows.filter((r) => r.seqs.includes(9))).toHaveLength(1);
  });

  it("shows the outcome where the result arrived, so what was said before it stays above it", () => {
    // 5 (agent) / call 6 / 7 (agent) / result 8 / 9 (agent): the two spoken fragments read together, then the outcome.
    const rows = timelineRows(failedSample.evidence);
    const spoken = rows.find((r) => r.seqs.includes(5))!;
    expect(spoken.kind === "speech" && spoken.turns.map((t) => t.seq)).toEqual([5, 7]);
    const outcome = rows.find((r) => r.seqs.includes(6))!;
    expect(outcome.seqs).toEqual([6, 8]);
    expect(rows.indexOf(outcome)).toBeGreaterThan(rows.indexOf(spoken));
    expect(rows.indexOf(outcome)).toBeLessThan(rows.findIndex((r) => r.seqs.includes(9)));
  });

  it("pairs a result that arrived before its call, and shows the one row where the result arrived", () => {
    const rows = timelineRows(resultBeforeCall.evidence);
    const action = rows.filter((r) => r.seqs.includes(22) || r.seqs.includes(24));
    expect(action).toHaveLength(1);
    expect(action[0].kind === "action" && action[0].entry.line).toBe("book_appointment succeeded");
    // The result is at 22, between the turns at 21 and 23.
    const at = rows.indexOf(action[0]);
    expect(at).toBeGreaterThan(rows.findIndex((r) => r.seqs.includes(21)));
    expect(at).toBeLessThan(rows.findIndex((r) => r.seqs.includes(23)));
    expect(rows.flatMap((r) => r.seqs).sort((a, b) => a - b)).toEqual(resultBeforeCall.evidence.items.map((i) => i.seq));
  });

  it("does not group turns across an outcome", () => {
    const rows = timelineRows(failedSample.evidence);
    expect(rows.find((r) => r.seqs.includes(7))).not.toBe(rows.find((r) => r.seqs.includes(9)));
  });

  it("shows every item once, and rows are never out of order by their last seq", () => {
    const rows = timelineRows(failedSample.evidence);
    const lasts = rows.map((r) => Math.max(...r.seqs));
    expect(lasts).toEqual([...lasts].sort((a, b) => a - b));
  });
});
