import { describe, expect, it } from "vitest";
import { echoableId, formatClock, formatStarted, shortened } from "./format";

describe("formatClock", () => {
  it("prints minutes and two-digit seconds, rounding down", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(142.585)).toBe("2:22");
    expect(formatClock(3601)).toBe("60:01");
  });
  it("never prints a negative time", () => {
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("formatStarted", () => {
  it("prints the date and time in the report's own timezone", () => {
    expect(formatStarted(1790205241776, "UTC")).toBe("Sep 23, 2026, 23:14 UTC");
    expect(formatStarted(1790205241776, "America/New_York")).toMatch(/Sep 23, 2026, 19:14 (EDT|GMT-4)/);
  });
  it("returns nothing for a timezone or a time it cannot print, so the page still renders", () => {
    expect(formatStarted(1790205241776, "Mars/Base")).toBeNull();
    expect(formatStarted(1790205241776, "")).toBeNull();
    expect(formatStarted(9e15, "UTC")).toBeNull();
  });
});

describe("echoableId", () => {
  it("passes an id that looks like one", () => {
    expect(echoableId("call_sample_failed")).toBe("call_sample_failed");
    expect(echoableId("call-1.2")).toBe("call-1.2");
  });
  it("refuses text that could pass for a message on a trusted page", () => {
    expect(echoableId("Contact support at x")).toBeNull();
    expect(echoableId("a".repeat(65))).toBeNull();
    expect(echoableId("")).toBeNull();
    expect(echoableId(null)).toBeNull();
  });
});

describe("shortened", () => {
  it("cuts long text and says it was cut", () => {
    expect(shortened("short", 10)).toBe("short");
    expect(shortened("abcdefghij", 5)).toBe("abcde...");
  });
});
