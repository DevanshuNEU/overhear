import { describe, expect, it } from "vitest";
import { sampleRows } from "@/demo-samples";
import { getReport } from "./store";
import { failedSample, needsReviewSample, passedSample } from "./samples";

describe("getReport", () => {
  it("finds each sample by its call id", async () => {
    for (const sample of [failedSample, needsReviewSample, passedSample]) {
      const found = await getReport(sample.callId);
      // The engine's own report for the sample call is served, so the list and the report always agree.
      expect(found.status).toBe("found");
      if (found.status === "found") expect(found.report).toMatchObject({ callId: sample.callId, verdict: sample.verdict });
    }
  });

  it("finds every demo sample by its call id", async () => {
    for (const row of sampleRows()) expect(await getReport(row.callId)).toMatchObject({ status: "found" });
  });

  it("says not found for an id it does not hold", async () => {
    expect(await getReport("call_nope")).toEqual({ status: "not_found", callId: "call_nope" });
  });

  it("reports a record that fails the schema as unreadable and never returns it", async () => {
    const broken = { ...failedSample, verdict: "passed" };
    const found = await getReport(failedSample.callId, async () => broken);
    expect(found.status).toBe("unreadable");
    if (found.status === "unreadable") {
      expect(found.callId).toBe(failedSample.callId);
      expect(found.problems.join(" ")).toMatch(/verdict/);
      expect(found).not.toHaveProperty("report");
    }
  });

  it("reports something that is not an object as unreadable", async () => {
    const found = await getReport("call_x", async () => "not a report");
    expect(found.status).toBe("unreadable");
  });
});
