import { describe, it, expect } from "vitest";
import { DEMO_HOME, demoCallHref, movedDemoPath } from "./demo-paths";

describe("demo paths", () => {
  it("the demo lives at /demo", () => {
    expect(DEMO_HOME).toBe("/demo");
  });

  it("a demo call's page is /demo/calls/{id}", () => {
    expect(demoCallHref("call_abc123")).toBe("/demo/calls/call_abc123");
  });

  it("encodes an id that is not URL safe", () => {
    expect(demoCallHref("a/b c")).toBe("/demo/calls/a%2Fb%20c");
  });

  it("maps an old /calls/{id} path to /demo/calls/{id}", () => {
    expect(movedDemoPath("/calls/abc")).toBe("/demo/calls/abc");
    expect(movedDemoPath("/calls/abc/")).toBe("/demo/calls/abc");
    expect(movedDemoPath("/calls/a%2Fb")).toBe("/demo/calls/a%2Fb");
  });

  it("leaves every other path alone", () => {
    for (const p of ["/", "/calls", "/calls/", "/calls/a/b", "/demo", "/demo/calls/abc", "/reports/call_sample_failed", "/callsx/abc", "/api/calls/abc"]) {
      expect(movedDemoPath(p), p).toBeNull();
    }
  });
});
