// @vitest-environment node
// analyzeRetellCall: a raw Retell record in, a validated report, a no_content or an error out, and never a throw.
import { describe, expect, it, vi } from "vitest";
import { NOT_A_RETELL_CALL } from "@/report/labels";
import { CallReportSchema } from "@/report/schema";
import { SAMPLE_REPORTS, failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { isDeepStrictEqual } from "node:util";
import preset from "./presets/northwind-clinic.json";
import { analyzeRetellCall } from "./analyze";
import * as check from "./check";
import { ev, type ItemSpec } from "./testing/build";
import { toRetell } from "./testing/retell";

// checkCall is the real one unless a test says otherwise.
vi.mock("./check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./check")>();
  return { ...actual, checkCall: vi.fn(actual.checkCall) };
});

const opts = { tz: "UTC" };
const isPreset = (policy: unknown) => isDeepStrictEqual(policy, preset);

describe("analyzeRetellCall", () => {
  it("turns a raw record into a validated report", () => {
    const out = analyzeRetellCall(toRetell(failedSample.evidence), opts);
    expect(out.kind).toBe("report");
    if (out.kind === "report") {
      expect(() => CallReportSchema.parse(out.report)).not.toThrow();
      expect(out.report.callId).toBe(failedSample.callId);
      expect(out.report.verdict).toBe("failed");
    }
  });

  it("reads a saved webhook body that holds the call", () => {
    const raw = { event: "call_analyzed", call: toRetell(passedSample.evidence) };
    const out = analyzeRetellCall(raw, opts);
    expect(out.kind === "report" && out.report.verdict).toBe("passed");
  });

  it("uses the demo preset for the demo agent's call and an inferred policy for any other", () => {
    const demo = analyzeRetellCall(toRetell(failedSample.evidence), opts);
    // The same call with the agent's tools renamed to ones the preset does not know: nothing is claimed that the
    // record cannot prove, so the missing transfer is not a violation.
    const renamed = JSON.parse(JSON.stringify(toRetell(failedSample.evidence)).replaceAll("check_availability", "find_openings").replaceAll("book_appointment", "make_booking")) as unknown;
    const other = analyzeRetellCall(renamed, opts);
    expect(demo.kind === "report" && demo.report.verdict).toBe("failed");
    expect(other.kind === "report" && other.report.verdict).toBe("needs_review");
  });

  // The clinic's zone is UTC in the preset. A lookup that errored before a retry must not cost the call its preset,
  // or a caller's own zone would be applied to slots the demo stores in UTC and a kept booking would read as broken.
  it("a retry after an errored lookup keeps the preset, so the caller's zone does not apply", () => {
    const turn = (role: "agent" | "caller", text: string, startSec: number): ItemSpec => ({ kind: "turn", role, text, startSec, interrupted: null });
    const raw = toRetell(
      ev([
        turn("caller", "Book me for Friday.", 1),
        { kind: "tool_call", id: "tc_1", name: "check_availability", args: {} },
        { kind: "tool_result", id: "tc_1", ok: null, platformOk: false, payload: "HTTP 500: Request failed" },
        { kind: "tool_call", id: "tc_2", name: "check_availability", args: {} },
        { kind: "tool_result", id: "tc_2", ok: null, platformOk: true, payload: { slots: [{ id: "slot_1", providerName: "Dr. Priya Nair", startsAt: "2026-11-06T14:00:00Z" }] } },
        { kind: "tool_call", id: "tc_3", name: "book_appointment", args: { slotId: "slot_1", patientId: "p1" } },
        { kind: "tool_result", id: "tc_3", ok: null, platformOk: true, payload: { ok: true } },
        turn("agent", "You're booked for Friday, November 6 at 2:00 p.m. with Dr. Priya Nair.", 30),
      ]),
    );
    const out = analyzeRetellCall(raw, { tz: "America/New_York" });
    expect(out.kind).toBe("report");
    if (out.kind === "report") {
      expect(out.report.verdict).toBe("passed");
      expect(out.report.timezone).toBe("UTC");
      expect(out.report.policy.tools).toHaveProperty("verify_patient");
    }
  });

  // Tool names alone never grant the preset: another agent can reuse the demo's names. Here the lookup fails and the
  // booking says nothing in the demo's shape, so the policy is inferred, a transfer that was never attempted cannot
  // be proved missing, and the call is not Failed.
  it("a failed lookup and a booking with no demo-shaped result do not earn the preset or a false Failed", () => {
    const turn = (role: "agent" | "caller", text: string, startSec: number): ItemSpec => ({ kind: "turn", role, text, startSec, interrupted: null });
    for (const booking of [[], [{ kind: "tool_result", id: "tc_2", ok: null, platformOk: true, payload: { status: "confirmed" } } as ItemSpec]]) {
      const raw = toRetell(
        ev([
          turn("caller", "I need an appointment.", 1),
          { kind: "tool_call", id: "tc_1", name: "check_availability", args: {} },
          { kind: "tool_result", id: "tc_1", ok: null, platformOk: false, payload: "HTTP 500: Request failed" },
          { kind: "tool_call", id: "tc_2", name: "book_appointment", args: { slotId: "x" } },
          ...booking,
          turn("agent", "Let me transfer you to someone who can help.", 30),
        ]),
      );
      const out = analyzeRetellCall(raw, { tz: "UTC" });
      expect(out.kind).toBe("report");
      if (out.kind === "report") {
        expect(out.report.verdict).not.toBe("failed");
        expect(out.report.policy.tools).not.toHaveProperty("verify_patient");
        expect(out.report.results.find((c) => c.contract === "transfer_kept")?.result).toBe("unverified");
      }
    }
  });

  describe("the demo agent's id", () => {
    const withAgent = (raw: unknown, agentId: unknown) => ({ ...(raw as Record<string, unknown>), agent_id: agentId });
    const verdictOf = (out: ReturnType<typeof analyzeRetellCall>) => (out.kind === "report" ? out.report.verdict : out.kind);
    const sourceOf = (out: ReturnType<typeof analyzeRetellCall>) => (out.kind === "report" ? (isPreset(out.report.policy) ? "preset" : "inferred") : out.kind);

    it("a call from another agent with demo-shaped results is inferred", () => {
      const raw = withAgent(toRetell(failedSample.evidence), "agent_other");
      const out = analyzeRetellCall(raw, { ...opts, demoAgentId: "agent_demo" });
      expect(sourceOf(out)).toBe("inferred");
      expect(verdictOf(out)).not.toBe("failed");
    });

    it("the call of the demo agent gets the preset", () => {
      const out = analyzeRetellCall(withAgent(toRetell(failedSample.evidence), "agent_demo"), { ...opts, demoAgentId: "agent_demo" });
      expect(sourceOf(out)).toBe("preset");
      expect(verdictOf(out)).toBe("failed");
    });

    it("a call with an agent id and no demo agent configured is inferred", () => {
      const out = analyzeRetellCall(withAgent(toRetell(failedSample.evidence), "agent_demo"), opts);
      expect(sourceOf(out)).toBe("inferred");
      expect(verdictOf(out)).not.toBe("failed");
    });

    // The OVE-38 hole: lookups all failed and the booking says only { ok: true }, which reads as the demo by shape.
    it("another agent whose lookups failed and whose booking is a bare ok is inferred, not Failed", () => {
      const turn = (role: "agent" | "caller", text: string, startSec: number): ItemSpec => ({ kind: "turn", role, text, startSec, interrupted: null });
      const raw = withAgent(
        toRetell(
          ev([
            turn("caller", "I need an appointment.", 1),
            { kind: "tool_call", id: "tc_1", name: "check_availability", args: {} },
            { kind: "tool_result", id: "tc_1", ok: null, platformOk: false, payload: "HTTP 500: Request failed" },
            { kind: "tool_call", id: "tc_2", name: "book_appointment", args: { slotId: "x" } },
            { kind: "tool_result", id: "tc_2", ok: null, platformOk: true, payload: { ok: true } },
            turn("agent", "Let me transfer you to someone who can help.", 30),
          ]),
        ),
        "agent_other",
      );
      // Without an agent id the shape rule grants the preset: that is the hole.
      const noId = analyzeRetellCall({ ...(raw as Record<string, unknown>), agent_id: undefined }, { ...opts, demoAgentId: "agent_demo" });
      expect(sourceOf(noId)).toBe("preset");
      const out = analyzeRetellCall(raw, { ...opts, demoAgentId: "agent_demo" });
      expect(sourceOf(out)).toBe("inferred");
      expect(verdictOf(out)).not.toBe("failed");
      expect(out.kind === "report" && out.report.results.find((c) => c.contract === "transfer_kept")?.result).toBe("unverified");
    });

    it("a call with no agent id behaves as before, with or without a demo agent configured", () => {
      for (const demoAgentId of [undefined, "agent_demo"]) {
        const o = { ...opts, demoAgentId };
        expect(verdictOf(analyzeRetellCall(toRetell(failedSample.evidence), o))).toBe("failed");
        expect(verdictOf(analyzeRetellCall(toRetell(passedSample.evidence), o))).toBe("passed");
        expect(verdictOf(analyzeRetellCall(toRetell(needsReviewSample.evidence), o))).toBe("needs_review");
        expect(sourceOf(analyzeRetellCall(toRetell(needsReviewSample.evidence), o))).toBe("inferred");
      }
    });

    it("an agent id that is not text counts as no agent id", () => {
      for (const id of [42, null, "", {}]) {
        const out = analyzeRetellCall(withAgent(toRetell(failedSample.evidence), id), { ...opts, demoAgentId: "agent_demo" });
        expect(verdictOf(out)).toBe("failed");
      }
    });

    it("keeps the agent id out of the report", () => {
      const out = analyzeRetellCall(withAgent(toRetell(failedSample.evidence), "agent_demo"), { ...opts, demoAgentId: "agent_demo" });
      expect(JSON.stringify(out)).not.toContain("agent_demo");
    });
  });

  it("handles a call with no turns", () => {
    expect(analyzeRetellCall({ call_id: "call_empty", transcript_with_tool_calls: [] }, opts)).toEqual({ kind: "no_content", callId: "call_empty", reason: "no_transcript" });
    expect(analyzeRetellCall({ call_id: "call_none" }, opts)).toEqual({ kind: "no_content", callId: "call_none", reason: "no_transcript" });
  });

  it("says plainly that a record is not a Retell call, without throwing", () => {
    for (const raw of [null, undefined, 42, "text", [], {}, { call_id: "" }]) {
      const out = analyzeRetellCall(raw, opts);
      expect(out).toEqual({ kind: "error", callId: null, message: expect.stringContaining(NOT_A_RETELL_CALL.message) });
    }
  });

  it("a thrown adapter error becomes an error outcome, not an exception", () => {
    const hostile = { call_id: "call_hostile", get transcript_with_tool_calls(): unknown { throw new Error("boom"); } };
    const out = analyzeRetellCall(hostile, opts);
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.callId).toBe("call_hostile");
      expect(out.message).toContain("boom");
    }
  });

  it("an invalid report becomes an error outcome", () => {
    // A failed call whose report says passed: the schema rejects it.
    vi.mocked(check.checkCall).mockImplementationOnce(() => ({ ...failedSample, verdict: "passed" }));
    const out = analyzeRetellCall(toRetell(failedSample.evidence), opts);
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.callId).toBe(failedSample.callId);
      expect(out.message).toMatch(/report|valid/i);
    }
  });

  it("an error message is plain: no stack, no path", () => {
    const hostile = { call_id: "call_hostile", get transcript_with_tool_calls(): unknown { throw new Error("boom"); } };
    const out = analyzeRetellCall(hostile, opts);
    expect(out.kind === "error" && out.message).not.toMatch(/\bat \w+.*\(|node_modules|\.ts:\d+/);
  });

  it("never throws on odd records", () => {
    const odd: unknown[] = [
      { call_id: "c", transcript_with_tool_calls: "not a list" },
      { call_id: "c", transcript_with_tool_calls: [null, 1, "x", {}] },
      { call_id: "c", transcript_with_tool_calls: [{ role: "agent", content: 5 }] },
      { call_id: "c", transcript_object: [{ role: "agent", content: "You're booked for Friday." }] },
      { call_id: "c", transcript_with_tool_calls: [{ role: "tool_call_invocation", tool_call_id: "t", name: "book_appointment", arguments: "{" }] },
    ];
    for (const raw of odd) {
      const out = analyzeRetellCall(raw, opts);
      expect(["report", "no_content", "error"]).toContain(out.kind);
      if (out.kind === "report") expect(() => CallReportSchema.parse(out.report)).not.toThrow();
    }
  });

  it("every output validates", () => {
    for (const sample of SAMPLE_REPORTS) {
      const out = analyzeRetellCall(toRetell(sample.evidence), opts);
      expect(out.kind).toBe("report");
      if (out.kind === "report") expect(() => CallReportSchema.parse(out.report)).not.toThrow();
    }
  });
});
