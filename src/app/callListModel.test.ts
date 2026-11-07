import { describe, expect, it } from "vitest";
import type { PullRow } from "@/pull/pull";
import { countRows, formatCallTime, secondsLeft, splitRows } from "./callListModel";

const row = (callId: string, patch: Partial<PullRow> = {}): PullRow => ({ callId, startedAt: 1, durationMs: 1000, state: "pending", ...patch });
const report = (callId: string, verdict: "failed" | "needs_review" | "passed") => row(callId, { state: "report", verdict, headline: "h" });

describe("countRows", () => {
  it("counts every kind of row once, so the counts add up to the total", () => {
    const rows = [report("a", "failed"), report("b", "failed"), report("c", "needs_review"), report("d", "passed"), row("e"), row("f", { state: "no_content" }), row("g", { state: "error" })];
    expect(countRows(rows)).toEqual({ total: 7, failed: 2, needsReview: 1, passed: 1, noContent: 1, errored: 1, pending: 1 });
  });
});

describe("splitRows", () => {
  it("puts failed, then needs review, then calls that did not load on top, each in the listed order", () => {
    const rows = [report("p1", "passed"), row("e1", { state: "error" }), report("r1", "needs_review"), row("w1"), report("f1", "failed"), report("f2", "failed"), row("n1", { state: "no_content" })];
    const { attention, rest } = splitRows(rows);
    expect(attention.map((r) => r.callId)).toEqual(["f1", "f2", "r1", "e1"]);
    expect(rest.map((r) => r.callId)).toEqual(["p1", "w1", "n1"]);
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
