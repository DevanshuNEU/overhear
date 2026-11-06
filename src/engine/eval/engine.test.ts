// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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

  // Task 10 adds src/engine/analyze.ts. From then on the stand-in must be gone, or every eval number is about it.
  it("is the real engine once src/engine/analyze.ts exists", () => {
    const built = fs.existsSync(path.join(__dirname, "..", "analyze.ts"));
    expect(isStandIn(engine), built ? "analyze.ts exists: swap the stand-in in src/engine/eval/engine.ts" : "").toBe(!built);
  });
});
