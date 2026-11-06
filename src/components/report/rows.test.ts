import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample } from "@/report/samples";
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

  it("does not group turns across something the system did", () => {
    const rows = timelineRows(failedSample.evidence);
    // 5 (agent) / call 6 / 7 (agent): two speech rows, not one.
    const five = rows.find((r) => r.seqs.includes(5))!;
    const seven = rows.find((r) => r.seqs.includes(7))!;
    expect(five).not.toBe(seven);
  });

  it("keeps rows in the order the call made them", () => {
    const rows = timelineRows(failedSample.evidence);
    const firsts = rows.map((r) => r.seqs[0]);
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
  });
});
