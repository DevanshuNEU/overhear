import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";
import { railColumns, railMarks, threadsOf } from "./threads";

describe("threadsOf", () => {
  it("makes one thread per finding, with the seqs it rests on in call order", () => {
    const threads = threadsOf(failedSample);
    expect(threads).toHaveLength(5);
    const transfer = threads.filter((t) => t.contract === "transfer_kept");
    expect(transfer.map((t) => t.seqs)).toEqual([[25], [27]]);
    const spoken = threads.find((t) => t.contract === "spoken_matches_committed")!;
    expect(spoken.seqs).toEqual([8, 22, 24, 25]);
  });

  it("numbers the findings of a contract that has several, and leaves a lone one plain", () => {
    const labels = threadsOf(failedSample).map((t) => t.label);
    expect(labels.filter((l) => l.startsWith("Promised transfers happen"))).toEqual(["Promised transfers happen, 1 of 2", "Promised transfers happen, 2 of 2"]);
    expect(labels).toContain("Promises backed by the system");
  });

  it("gives every thread a unique anchor", () => {
    const anchors = threadsOf(failedSample).map((t) => t.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("makes a thread of a review reason, and of each gap", () => {
    const reason = threadsOf(needsReviewSample);
    expect(reason).toHaveLength(2);
    expect(reason[0]).toMatchObject({ anchor: "reason-0", seqs: [4, 7, 9], railed: true, result: "unverified", label: "Unanswered request" });
    expect(reason[1]).toMatchObject({ anchor: "reason-1", seqs: [12], railed: true, result: "unverified" });
    // An unverified-result reason repeats its rule's finding, so it makes no thread of its own.
    expect(threadsOf(unverifiedSample).filter((t) => t.anchor.startsWith("reason-"))).toEqual([]);
    const gaps = threadsOf(unverifiedSample).filter((t) => t.anchor.startsWith("gap-"));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ anchor: "gap-0", seqs: [33], railed: false, label: "A tool result gave no success signal" });
  });

  it("draws rails only for threads that need attention", () => {
    const threads = threadsOf(failedSample);
    expect(threads.filter((t) => t.railed).map((t) => t.result)).toEqual(["violated", "violated"]);
    expect(threadsOf(passedSample).some((t) => t.railed)).toBe(false);
  });
});

describe("railMarks", () => {
  const thread = (id: string, seqs: number[]) => ({ id, anchor: id, result: "violated" as const, seqs, railed: true, label: id });
  const one = (n: number) => Array.from({ length: n }, (_, i) => [i + 1]);

  it("puts a dot on each row the thread cites and a line on the rows between", () => {
    const marks = railMarks([thread("a", [2, 5])], one(6));
    expect(marks[0]).toEqual([]);
    expect(marks[1]).toEqual([{ id: "a", mark: "dot", first: true, last: false }]);
    expect(marks[2]).toEqual([{ id: "a", mark: "line", first: false, last: false }]);
    expect(marks[4]).toEqual([{ id: "a", mark: "dot", first: false, last: true }]);
    expect(marks[5]).toEqual([]);
  });

  it("reads a row that stands for several seqs, such as a tool call and its result, as one place", () => {
    // Rows: [1] [2 and 4: a call and its result] [3] [5]. The thread cites 4 and 5.
    const marks = railMarks([thread("a", [4, 5])], [[1], [2, 4], [3], [5]]);
    expect(marks.map((m) => m.map((x) => x.mark))).toEqual([[], ["dot"], ["line"], ["dot"]]);
    expect(marks[1][0].first).toBe(true);
    expect(marks[3][0].last).toBe(true);
  });

  it("ignores threads that are not railed or cite nothing", () => {
    expect(railMarks([{ ...thread("a", [2, 5]), railed: false }], one(6)).flat()).toEqual([]);
    expect(railMarks([thread("a", [])], one(3)).flat()).toEqual([]);
  });

  it("puts overlapping threads in their own columns, in the order they are given", () => {
    const marks = railMarks([thread("a", [1, 4]), thread("b", [3, 6])], one(6));
    expect(marks[2].map((r) => [r.id, r.mark])).toEqual([["a", "line"], ["b", "dot"]]);
    expect(marks[3].map((r) => [r.id, r.mark, r.last])).toEqual([["a", "dot", true], ["b", "line", false]]);
  });

  it("gives a thread of one row a dot that is both first and last", () => {
    expect(railMarks([thread("a", [5])], one(5))[4]).toEqual([{ id: "a", mark: "dot", first: true, last: true }]);
  });
});

describe("railColumns", () => {
  it("puts the findings of one rule in one column, and other rules in their own", () => {
    const threads = threadsOf(unverifiedSample);
    const cols = railColumns(threads);
    const railed = threads.filter((t) => t.railed);
    expect(new Set(railed.map((t) => cols.get(t.id))).size).toBe(new Set(railed.map((t) => t.contract ?? t.id)).size);
    const failed = threadsOf(failedSample).filter((t) => t.railed);
    const failedCols = railColumns(threadsOf(failedSample));
    expect(failed).toHaveLength(2);
    expect(failedCols.get(failed[0].id)).toBe(failedCols.get(failed[1].id));
  });

  it("numbers columns from zero, in the order the rules first appear", () => {
    const cols = railColumns(threadsOf(unverifiedSample));
    expect([...new Set(cols.values())].sort()).toEqual(Array.from({ length: new Set(cols.values()).size }, (_, i) => i));
  });
});
