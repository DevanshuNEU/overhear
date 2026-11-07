// @vitest-environment node
// The analyzer the pull routes pass in: the engine's analyzeRetellCall with this machine's time zone. The zone is
// read here, in src/pull, never in the engine (the engine's purity guard forbids it).
import { isDeepStrictEqual } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import preset from "@/engine/presets/northwind-clinic.json";
import { analyzeRetellCall } from "@/engine/analyze";
import { toRetell } from "@/engine/testing/retell";
import type { Outcome } from "@/engine/types";
import { failedSample, passedSample } from "@/report/samples";
import { analyzeCall } from "./analyzer";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** Makes the machine report this zone (or none) from Intl.DateTimeFormat().resolvedOptions(). */
function reportZone(timeZone: string | undefined) {
  const real = Intl.DateTimeFormat;
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
    const format = new real(...args);
    const resolved = format.resolvedOptions.bind(format);
    format.resolvedOptions = () => ({ ...resolved(), timeZone: timeZone as string });
    return format;
  } as unknown as typeof Intl.DateTimeFormat);
}

describe("analyzeCall", () => {
  it("is analyzeRetellCall with the machine's zone", () => {
    const raw = toRetell(failedSample.evidence);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(analyzeCall(raw)).toEqual(analyzeRetellCall(raw, { tz: zone }));
    const out = analyzeCall(raw);
    expect(out.kind === "report" && out.report.verdict).toBe("failed");
  });

  it("hands the engine whatever zone the machine reports", () => {
    reportZone("Asia/Kolkata");
    const raw = toRetell(failedSample.evidence);
    expect(analyzeCall(raw)).toEqual(analyzeRetellCall(raw, { tz: "Asia/Kolkata" }));
  });

  it("falls back to UTC when the machine reports no zone", () => {
    reportZone(undefined);
    const raw = toRetell(failedSample.evidence);
    expect(analyzeCall(raw)).toEqual(analyzeRetellCall(raw, { tz: "UTC" }));
  });

  describe("the demo agent's id", () => {
    const record = (agentId: string) => ({ ...(toRetell(failedSample.evidence) as Record<string, unknown>), agent_id: agentId });
    const hasPreset = (out: Outcome) => out.kind === "report" && isDeepStrictEqual(out.report.policy, preset);

    it("passes OVERHEAR_DEMO_AGENT_ID to the engine, read when the call is analyzed", () => {
      vi.stubEnv("OVERHEAR_DEMO_AGENT_ID", "agent_demo");
      expect(hasPreset(analyzeCall(record("agent_demo")))).toBe(true);
      expect(hasPreset(analyzeCall(record("agent_other")))).toBe(false);
      vi.stubEnv("OVERHEAR_DEMO_AGENT_ID", "agent_other");
      expect(hasPreset(analyzeCall(record("agent_other")))).toBe(true);
    });

    it("with the variable unset or empty, a pulled call that has an agent id never gets the preset", () => {
      vi.stubEnv("OVERHEAR_DEMO_AGENT_ID", undefined);
      expect(hasPreset(analyzeCall(record("agent_demo")))).toBe(false);
      vi.stubEnv("OVERHEAR_DEMO_AGENT_ID", "");
      expect(hasPreset(analyzeCall(record("agent_demo")))).toBe(false);
    });

    it("a call with no agent id keeps the shape rule, so the samples are unchanged", () => {
      vi.stubEnv("OVERHEAR_DEMO_AGENT_ID", undefined);
      const failed = analyzeCall(toRetell(failedSample.evidence));
      const passed = analyzeCall(toRetell(passedSample.evidence));
      expect(failed.kind === "report" && failed.report.verdict).toBe("failed");
      expect(passed.kind === "report" && passed.report.verdict).toBe("passed");
    });
  });

  it("answers an error outcome, never a throw, for a record it cannot read", () => {
    expect(analyzeCall(42).kind).toBe("error");
  });
});
