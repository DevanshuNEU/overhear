// @vitest-environment node
// analyzeRetellCall: a raw Retell record in, a validated report, a no_content or an error out, and never a throw.
import { describe, expect, it, vi } from "vitest";
import { NOT_A_RETELL_CALL } from "@/report/labels";
import { CallReportSchema } from "@/report/schema";
import { SAMPLE_REPORTS, failedSample, passedSample } from "@/report/samples";
import { analyzeRetellCall } from "./analyze";
import * as check from "./check";
import { toRetell } from "./testing/retell";

// checkCall is the real one unless a test says otherwise.
vi.mock("./check", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./check")>();
  return { ...actual, checkCall: vi.fn(actual.checkCall) };
});

const opts = { tz: "UTC" };

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
