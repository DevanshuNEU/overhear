import { describe, it, expect } from "vitest";
import { movedDemoPath } from "./demo-paths";

describe("demo paths", () => {
  it("sends the old demo pages to the home page", () => {
    for (const p of ["/demo", "/demo/", "/demo/calls/abc", "/demo/calls/abc/", "/calls/abc", "/calls/abc/", "/calls/a%2Fb"]) {
      expect(movedDemoPath(p), p).toBe("/");
    }
  });

  it("leaves every other path alone", () => {
    for (const p of ["/", "/calls", "/calls/", "/calls/a/b", "/demo/calls", "/demo/calls/a/b", "/demox", "/reports/call_sample_failed", "/callsx/abc", "/api/calls/abc", "/api/demo-calls", "/api/demo-calls/abc"]) {
      expect(movedDemoPath(p), p).toBeNull();
    }
  });
});
