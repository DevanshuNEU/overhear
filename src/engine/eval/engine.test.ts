// @vitest-environment node
import { describe, expect, it } from "vitest";
import { failedSample } from "@/report/samples";
import { analyzeRetellCall } from "../analyze";
import { toRetell } from "../testing/retell";
import { engine, engineLabel, engineNotBuiltYet, isStandIn } from "./engine";

describe("the engine the eval runs", () => {
  it("the stand-in says plainly that the engine is not built, for every record", () => {
    expect(engineNotBuiltYet({ call_id: "x" }, { tz: "UTC" })).toEqual({ kind: "error", callId: null, message: "engine not built yet" });
    expect(engineNotBuiltYet(null, { tz: "UTC" })).toEqual({ kind: "error", callId: null, message: "engine not built yet" });
  });

  it("knows the stand-in from any other engine", () => {
    expect(isStandIn(engineNotBuiltYet)).toBe(true);
    expect(isStandIn(() => ({ kind: "no_content", callId: "x", reason: "no_transcript" }))).toBe(false);
  });

  it("labels the engine for the report", () => {
    expect(engineLabel(engineNotBuiltYet)).toBe("stand-in (engine not built yet)");
    expect(engineLabel(() => ({ kind: "no_content", callId: "x", reason: "no_transcript" }))).toBe("analyzeRetellCall");
  });

  // The stand-in must never be the engine the eval runs, or every eval number is about it.
  it("is the real engine, analyzeRetellCall, not the stand-in", () => {
    expect(engine).toBe(analyzeRetellCall);
    expect(isStandIn(engine)).toBe(false);
    expect(engineLabel(engine)).toBe("analyzeRetellCall");
  });

  it("the real engine answers a call record with a report", () => {
    const out = engine(toRetell(failedSample.evidence), { tz: "UTC" });
    expect(out.kind === "report" && out.report.verdict).toBe("failed");
  });
});
