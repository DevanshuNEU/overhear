// @vitest-environment node
// analyzeRecord on real LiveKit output: the five session reports livekit-agents 1.8.13 wrote (eval/engine/cases/livekit-*.json),
// run through the same pipeline as a Retell call. Also: how analyzeRecord tells the two platforms apart.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NOT_A_CALL_RECORD } from "@/report/labels";
import type { CallReport } from "@/report/schema";
import { SAMPLE_REPORTS, failedSample } from "@/report/samples";
import { analyzeRecord, analyzeRetellCall } from "./analyze";
import { toRetell } from "./testing/retell";

const opts = { tz: "UTC" };
const CASES = path.resolve(__dirname, "../../eval/engine/cases");

function record(id: string): unknown {
  return (JSON.parse(fs.readFileSync(path.join(CASES, `livekit-${id}.json`), "utf8")) as { record: unknown }).record;
}

function reportOf(id: string): CallReport {
  const out = analyzeRecord(record(id), opts);
  if (out.kind !== "report") throw new Error(`${id}: expected a report, got ${JSON.stringify(out)}`);
  return out.report;
}

const result = (r: CallReport, contract: string) => r.results.find((x) => x.contract === contract);

describe("analyzeRecord on real LiveKit reports", () => {
  it("booking-success: passed, the promise is kept", () => {
    const r = reportOf("booking-success");
    expect(r.platform).toBe("livekit");
    expect(r.verdict).toBe("passed");
    expect(result(r, "promise_backed")?.result).toBe("passed");
  });

  it("booking-error-said-booked: failed, promise_backed violated, citing the claim turn and the failed call and result", () => {
    const r = reportOf("booking-error-said-booked");
    expect(r.verdict).toBe("failed");
    const promise = result(r, "promise_backed");
    expect(promise?.result).toBe("violated");
    const finding = promise?.findings.find((f) => f.result === "violated");
    // seq 9 is "you're booked", 7 the book_appointment call and 8 its result with is_error true.
    expect(finding?.said).toEqual([9]);
    expect(finding?.did).toEqual([7, 8]);
    const tool = r.evidence.items[7];
    expect(tool).toMatchObject({ kind: "tool_result", platformOk: false, ok: false });
  });

  it("transfer-no-tool: a transfer claim with no tool in the record is unverified, not violated, because the engine reads an empty tool list as a missing tool transcript", () => {
    const r = reportOf("transfer-no-tool");
    expect(r.verdict).toBe("needs_review");
    const transfer = result(r, "transfer_kept");
    expect(transfer?.result).toBe("unverified");
    expect(transfer?.findings[0].gaps).toEqual(["missing_tool_transcript"]);
  });

  it("caller-hung-up-mid-announcement: unverified, never violated (today for the missing-tool reason, not the caller-left one)", () => {
    const r = reportOf("caller-hung-up-mid-announcement");
    expect(r.evidence.callFields.disconnection_reason).toBe("user_hangup");
    expect(r.verdict).toBe("needs_review");
    const transfer = result(r, "transfer_kept");
    expect(transfer?.result).toBe("unverified");
    // The speech detector does read the cut-off "I'm transferring you to " as a transfer claim.
    expect(r.detections.some((d) => d.cls === "transfer" && d.seq === 4)).toBe(true);
  });

  it("interrupted-turn: the agent turn carries interrupted true", () => {
    const r = reportOf("interrupted-turn");
    const turns = r.evidence.items.filter((it) => it.kind === "turn");
    expect(turns.find((t) => t.role === "agent")?.interrupted).toBe(true);
    expect(turns.find((t) => t.role === "caller")?.interrupted).toBe(false);
  });
});

describe("analyzeRecord", () => {
  it("reads Retell calls exactly as analyzeRetellCall does", () => {
    for (const s of SAMPLE_REPORTS) {
      const raw = toRetell(s.evidence);
      expect(analyzeRecord(raw, opts)).toEqual(analyzeRetellCall(raw, opts));
    }
    const wrapped = { event: "call_analyzed", call: toRetell(failedSample.evidence) };
    expect(analyzeRecord(wrapped, opts)).toEqual(analyzeRetellCall(wrapped, opts));
  });

  it("returns no_content for a LiveKit report with no messages", () => {
    const raw = { job_id: "AJ_empty", chat_history: { items: [] } };
    expect(analyzeRecord(raw, opts)).toEqual({ kind: "no_content", callId: "AJ_empty", reason: "no_transcript" });
  });

  it("says plainly that a record is neither format, naming both, without throwing", () => {
    for (const raw of [null, undefined, 42, "text", [], {}, { chat_history: { items: [] } }, { job_id: "x" }]) {
      const out = analyzeRecord(raw, opts);
      expect(out).toEqual({ kind: "error", callId: null, message: expect.stringContaining("Retell") });
      expect(out.kind === "error" && out.message).toContain("LiveKit");
      expect(out.kind === "error" && out.message).toContain(NOT_A_CALL_RECORD.message);
    }
  });

  it("a LiveKit report with no usable id is an error", () => {
    const out = analyzeRecord({ job_id: "", room_id: "", room: "", sdk_version: "1", chat_history: { items: [] } }, opts);
    expect(out).toEqual({ kind: "error", callId: null, message: expect.stringContaining("job_id") });
  });
});
