// @vitest-environment node
// EngineOptions.policy: a team's own policy replaces the preset and the inferred one for every call, and counts like
// the preset: it names every tool the agent has, so a promised transfer with no transfer tool reads Failed.
import { describe, expect, it } from "vitest";
import { PolicySchema, type Policy } from "@/report/schema";
import { failedSample } from "@/report/samples";
import { analyzeRecord, analyzeRetellCall } from "./analyze";
import preset from "./presets/northwind-clinic.json";
import { toRetell } from "./testing/retell";

const opts = { tz: "UTC" };

/** The failed sample with the agent's tools renamed, so nothing but a policy can say what they are. */
const renamed = JSON.parse(JSON.stringify(toRetell(failedSample.evidence)).replaceAll("check_availability", "find_openings").replaceAll("book_appointment", "make_booking")) as Record<string, unknown>;

function userPolicy(): Policy {
  const p = structuredClone(preset) as Policy;
  p.timezone = "Asia/Kolkata";
  p.tools = { ...p.tools, find_openings: p.tools.check_availability, make_booking: p.tools.book_appointment };
  delete p.tools.check_availability;
  delete p.tools.book_appointment;
  return PolicySchema.parse(p);
}

const verdict = (o: ReturnType<typeof analyzeRecord>) => (o.kind === "report" ? o.report.verdict : o.kind);

describe("EngineOptions.policy", () => {
  it("is used instead of an inferred policy, and a promised transfer with no transfer tool reads Failed", () => {
    expect(verdict(analyzeRetellCall(renamed, opts))).toBe("needs_review");
    const out = analyzeRetellCall(renamed, { ...opts, policy: userPolicy() });
    expect(verdict(out)).toBe("failed");
    if (out.kind !== "report") throw new Error("expected a report");
    expect(out.report.policy).toEqual({ ...userPolicy(), packs: ["healthcare"] });
    expect(out.report.timezone).toBe("Asia/Kolkata");
    expect(out.report.results.find((r) => r.contract === "transfer_kept")?.result).toBe("violated");
  });

  it("is used instead of the preset for the demo agent's call", () => {
    const demo = { ...(toRetell(failedSample.evidence) as Record<string, unknown>), agent_id: "agent_demo" };
    const mine = userPolicy();
    mine.timezone = "America/Chicago";
    const out = analyzeRetellCall(demo, { ...opts, demoAgentId: "agent_demo", policy: mine });
    expect(out.kind === "report" && out.report.policy).toEqual({ ...mine, packs: ["healthcare"] });
  });

  it("applies through analyzeRecord too", () => {
    const mine = userPolicy();
    const out = analyzeRecord(renamed, { ...opts, policy: mine });
    expect(out.kind === "report" && out.report.policy).toEqual({ ...mine, packs: ["healthcare"] });
  });

  it("an inferred policy with no transfer tool reads unverified, not violated", () => {
    const out = analyzeRetellCall(renamed, opts);
    if (out.kind !== "report") throw new Error("expected a report");
    expect(out.report.results.find((r) => r.contract === "transfer_kept")?.result).toBe("unverified");
  });

  it("an invalid policy is an error outcome that names the problem, never a guess", () => {
    const out = analyzeRetellCall(renamed, { ...opts, policy: { packs: [], tools: {} } as unknown as Policy });
    expect(out.kind).toBe("error");
    if (out.kind === "error") expect(out.message).toContain("The policy is not valid");
  });
});
