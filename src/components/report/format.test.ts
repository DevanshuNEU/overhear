import { describe, expect, it } from "vitest";
import { formatClock, formatStarted } from "./format";

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
