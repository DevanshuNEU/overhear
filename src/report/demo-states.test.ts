import { afterEach, describe, expect, it, vi } from "vitest";
import { CallReportSchema } from "./schema";
import { demoSource, unverifiedSample } from "./demo-states";
import { getReport } from "./store";

afterEach(() => vi.unstubAllEnvs());

describe("the demo states", () => {
  it("builds an unverified report that the schema accepts", () => {
    expect(CallReportSchema.safeParse(unverifiedSample).success).toBe(true);
    expect(unverifiedSample.verdict).toBe("needs_review");
    expect(unverifiedSample.evidence.gaps.map((g) => g.code)).toEqual(["unknown_success"]);
    const unverified = unverifiedSample.results.filter((c) => c.result === "unverified").map((c) => c.contract);
    expect(unverified).toEqual(["promise_backed", "verified_before_change", "spoken_matches_committed"]);
    for (const c of unverifiedSample.results) for (const f of c.findings) if (f.result === "unverified") expect(f.gaps).toEqual(["unknown_success"]);
  });

  it("serves the demo ids only when the flag is on", async () => {
    expect(await getReport("call_demo_unverified")).toEqual({ status: "not_found", callId: "call_demo_unverified" });
    vi.stubEnv("OVERHEAR_DEMO_STATES", "1");
    expect((await getReport("call_demo_unverified")).status).toBe("found");
    expect((await getReport("call_demo_unreadable")).status).toBe("unreadable");
    expect((await getReport("call_sample_failed")).status).toBe("found");
  });

  it("serves nothing in production, even with the flag on, so no slow request can be asked for", async () => {
    vi.stubEnv("OVERHEAR_DEMO_STATES", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(await getReport("call_demo_slow")).toEqual({ status: "not_found", callId: "call_demo_slow" });
    expect(await getReport("call_demo_unverified")).toEqual({ status: "not_found", callId: "call_demo_unverified" });
  });

  it("holds a record that does not validate, and says which part", async () => {
    const record = await demoSource("call_demo_unreadable");
    const parsed = CallReportSchema.safeParse(record);
    expect(parsed.success).toBe(false);
  });
});
