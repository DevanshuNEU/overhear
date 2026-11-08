import { describe, expect, it } from "vitest";
import type { PullRow } from "@/pull/pull";
import { countRows, formatCallTime, secondsLeft, splitRows } from "./callListModel";

const row = (callId: string, patch: Partial<PullRow> = {}): PullRow => ({ callId, startedAt: 1, durationMs: 1000, state: "pending", ...patch });
const report = (callId: string, verdict: "failed" | "needs_review" | "passed" | "nothing_done") => row(callId, { state: "report", verdict, headline: "h" });

describe("countRows", () => {
  it("counts every kind of row once, so the counts add up to the total", () => {
    const rows = [report("a", "failed"), report("b", "failed"), report("c", "needs_review"), report("d", "passed"), row("e"), row("f", { state: "no_content" }), row("g", { state: "error" })];
    expect(countRows(rows)).toEqual({ total: 7, failed: 2, needsReview: 1, passed: 1, nothingDone: 0, noContent: 1, errored: 1, pending: 1 });
  });
});

describe("Nothing done calls", () => {
  it("counts under their own nothingDone count, not under passed", () => {
    const counts = countRows([report("a", "nothing_done"), report("b", "passed")]);
    expect(counts).toMatchObject({ total: 2, passed: 1, nothingDone: 1 });
  });

  it("sorts after passed calls and does not go on top", () => {
    const { attention, rest } = splitRows([report("n1", "nothing_done"), report("p1", "passed"), report("f1", "failed"), report("n2", "nothing_done"), report("p2", "passed")]);
    expect(attention.map((r) => r.callId)).toEqual(["f1"]);
    expect(rest.map((r) => r.callId)).toEqual(["p1", "p2", "n1", "n2"]);
  });

  it("sorts after the calls that still need something, a pending call or one with a Retry, as well as after passed calls", () => {
    const { rest } = splitRows([report("n1", "nothing_done"), row("w1"), report("p1", "passed"), row("e1", { state: "error" }), row("c1", { state: "no_content" })]);
    expect(rest.map((r) => r.callId)).toEqual(["w1", "p1", "e1", "c1", "n1"]);
  });

  it("is not a call to look at, so a list of only Nothing done calls has no look-at-these group", () => {
    const { attention, rest } = splitRows([report("n1", "nothing_done"), report("n2", "nothing_done")]);
    expect(attention).toEqual([]);
    expect(rest).toHaveLength(2);
  });
});

describe("splitRows", () => {
  it("puts failed, then needs review on top, each in the listed order, and leaves calls that did not load where they were listed", () => {
    const rows = [report("p1", "passed"), row("e1", { state: "error" }), report("r1", "needs_review"), row("w1"), report("f1", "failed"), report("f2", "failed"), row("n1", { state: "no_content" })];
    const { attention, rest } = splitRows(rows);
    expect(attention.map((r) => r.callId)).toEqual(["f1", "f2", "r1"]);
    expect(rest.map((r) => r.callId)).toEqual(["p1", "e1", "w1", "n1"]);
  });
});

describe("formatCallTime", () => {
  it("prints the call's time in the zone given, 24 hour", () => {
    const ms = Date.UTC(2026, 10, 6, 15, 42);
    expect(formatCallTime(ms, "UTC")).toBe("Nov 6, 15:42");
    expect(formatCallTime(ms, "America/New_York")).toBe("Nov 6, 10:42");
  });

  it("gives null for a time it cannot print", () => {
    expect(formatCallTime(Number.NaN, "UTC")).toBeNull();
  });
});

describe("secondsLeft", () => {
  it("rounds up and never shows zero while the pause lasts", () => {
    expect(secondsLeft(5000, 1000)).toBe(4);
    expect(secondsLeft(5000, 1001)).toBe(4);
    expect(secondsLeft(5000, 4999)).toBe(1);
    expect(secondsLeft(5000, 9000)).toBe(1);
  });
});
