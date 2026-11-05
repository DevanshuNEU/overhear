import { describe, expect, it } from "vitest";
import { getReport } from "./store";
import { failedSample, needsReviewSample, passedSample } from "./samples";

describe("getReport", () => {
  it("finds each sample by its call id", async () => {
    for (const sample of [failedSample, needsReviewSample, passedSample]) {
      const found = await getReport(sample.callId);
      expect(found).toEqual({ status: "found", report: sample });
    }
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
