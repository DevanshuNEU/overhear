// @vitest-environment node
// The analyzer the pull routes pass in: the engine's analyzeRetellCall with this machine's time zone. The zone is
// read here, in src/pull, never in the engine (the engine's purity guard forbids it).
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeRetellCall } from "@/engine/analyze";
import { toRetell } from "@/engine/testing/retell";
import { failedSample } from "@/report/samples";
import { analyzeCall } from "./analyzer";

afterEach(() => vi.restoreAllMocks());

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

  it("answers an error outcome, never a throw, for a record it cannot read", () => {
    expect(analyzeCall(42).kind).toBe("error");
  });
});
