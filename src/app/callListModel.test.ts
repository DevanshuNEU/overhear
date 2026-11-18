import { describe, expect, it } from "vitest";
import type { PullRow } from "@/pull/pull";
import { countRows, filterRows, formatCallTime, parseFilter, secondsLeft, splitRows, type Filter } from "./callListModel";

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

describe("parseFilter", () => {
  it("reads the four verdicts from the address and treats everything else as All", () => {
    expect(parseFilter("failed")).toBe("failed");
    expect(parseFilter("needs_review")).toBe("needs_review");
    expect(parseFilter("passed")).toBe("passed");
    expect(parseFilter("nothing_done")).toBe("nothing_done");
    expect(parseFilter(null)).toBe("all");
    expect(parseFilter(undefined)).toBe("all");
    expect(parseFilter("")).toBe("all");
    expect(parseFilter("all")).toBe("all");
    expect(parseFilter("<script>")).toBe("all");
  });
});

describe("filterRows", () => {
  const rows = [
    report("p1", "passed"),
    row("e1", { state: "error" }),
    report("r1", "needs_review"),
    row("w1"),
    report("f1", "failed"),
    report("n1", "nothing_done"),
    report("f2", "failed"),
    row("c1", { state: "no_content" }),
    report("p2", "passed"),
  ];
  const ids = (filter: Filter) => filterRows(rows, filter).map((r) => r.callId);

  it("All is the two groups one after the other, so the stepper walks the list top to bottom", () => {
    const { attention, rest } = splitRows(rows);
    expect(ids("all")).toEqual([...attention, ...rest].map((r) => r.callId));
    expect(ids("all")).toEqual(["f1", "f2", "r1", "p1", "e1", "w1", "c1", "p2", "n1"]);
  });

  it("a verdict keeps only that verdict's calls, in the order the groups give", () => {
    expect(ids("failed")).toEqual(["f1", "f2"]);
    expect(ids("needs_review")).toEqual(["r1"]);
    expect(ids("passed")).toEqual(["p1", "p2"]);
    expect(ids("nothing_done")).toEqual(["n1"]);
  });

  it("leaves out calls that could not be checked, have no transcript or are still waiting, under every verdict", () => {
    for (const f of ["failed", "needs_review", "passed", "nothing_done"] as const) {
      expect(ids(f)).not.toContain("e1");
      expect(ids(f)).not.toContain("w1");
      expect(ids(f)).not.toContain("c1");
    }
  });

  it("gives nothing for a verdict no call has", () => {
    expect(filterRows([report("p1", "passed")], "failed")).toEqual([]);
    expect(filterRows([], "all")).toEqual([]);
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
