import { describe, expect, it } from "vitest";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { railsAt, threadsOf } from "./threads";

describe("threadsOf", () => {
  it("makes one thread per finding, with the seqs it rests on in call order", () => {
    const threads = threadsOf(failedSample);
    expect(threads).toHaveLength(5);
    const transfer = threads.filter((t) => t.contract === "transfer_kept");
    expect(transfer.map((t) => t.seqs)).toEqual([[25], [27]]);
    const spoken = threads.find((t) => t.contract === "spoken_matches_committed")!;
    expect(spoken.seqs).toEqual([8, 22, 24, 25]);
  });

  it("gives every thread a unique anchor", () => {
    const anchors = threadsOf(failedSample).map((t) => t.anchor);
    expect(new Set(anchors).size).toBe(anchors.length);
  });

  it("has no threads for a report with no findings", () => {
    expect(threadsOf(needsReviewSample)).toEqual([]);
  });

  it("draws rails only for threads that need attention", () => {
    const threads = threadsOf(failedSample);
    expect(threads.filter((t) => t.railed).map((t) => t.result)).toEqual(["violated", "violated"]);
    expect(threadsOf(passedSample).some((t) => t.railed)).toBe(false);
  });
});

describe("railsAt", () => {
  const thread = (id: string, seqs: number[]) => ({ id, anchor: id, contract: "promise_backed" as const, result: "violated" as const, seqs, railed: true, label: id });

  it("puts a dot on each member and a line on the items between", () => {
    const t = [thread("a", [2, 5])];
    expect(railsAt(t, 1)).toEqual([]);
    expect(railsAt(t, 2)).toEqual([{ id: "a", mark: "dot", first: true, last: false }]);
    expect(railsAt(t, 3)).toEqual([{ id: "a", mark: "line", first: false, last: false }]);
    expect(railsAt(t, 5)).toEqual([{ id: "a", mark: "dot", first: false, last: true }]);
    expect(railsAt(t, 6)).toEqual([]);
  });

  it("ignores threads that are not railed", () => {
    expect(railsAt([{ ...thread("a", [2, 5]), railed: false }], 2)).toEqual([]);
  });
});
