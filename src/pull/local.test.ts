// @vitest-environment node
import { describe, it, expect } from "vitest";
import { isLocalMode } from "./local";

describe("isLocalMode", () => {
  it("is on only when OVERHEAR_LOCAL is 1", () => {
    expect(isLocalMode({ OVERHEAR_LOCAL: "1" })).toBe(true);
  });

  it("is off when OVERHEAR_LOCAL is unset, empty or any other value", () => {
    for (const value of [undefined, "", "0", "true", "yes"]) {
      expect(isLocalMode({ OVERHEAR_LOCAL: value }), String(value)).toBe(false);
    }
  });

  it("reads process.env by default", () => {
    const before = process.env.OVERHEAR_LOCAL;
    try {
      process.env.OVERHEAR_LOCAL = "1";
      expect(isLocalMode()).toBe(true);
      delete process.env.OVERHEAR_LOCAL;
      expect(isLocalMode()).toBe(false);
    } finally {
      if (before === undefined) delete process.env.OVERHEAR_LOCAL;
      else process.env.OVERHEAR_LOCAL = before;
    }
  });
});
