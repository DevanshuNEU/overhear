// @vitest-environment node
import { describe, expect, it } from "vitest";
import { analyzeRetellCall } from "@/engine/analyze";
import { parseCase, type EvalCase } from "@/engine/eval/case";
import type { Analyze } from "@/engine/types";
import { checkPins, duplicateIds } from "./check";
import type { PinEntry } from "./store";
import { failedPin, passedPin } from "./testing";

const entry = (pin: EvalCase): PinEntry => ({ id: pin.id, pin });
/** The pin with its expectation edited, and still a valid pin. */
const edited = (pin: EvalCase, expectPatch: Record<string, unknown>): EvalCase => parseCase({ ...pin, expect: { ...pin.expect, ...expectPatch } });

describe("checkPins", () => {
  it("a pin that keeps what the engine says holds, and a list keeps its order", () => {
    const results = checkPins([failedPin(), passedPin()].map(entry), analyzeRetellCall);
    expect(results.map((r) => [r.id, r.status, r.changes])).toEqual([
      [failedPin().id, "held", []],
      [passedPin().id, "held", []],
    ]);
    expect(results[0].actual.verdict).toBe("failed");
    expect(results[0].expected).toEqual({
      verdict: "failed",
      contracts: { promise_backed: "passed", spoken_matches_committed: "passed", transfer_kept: "violated", committed_matches_request: "not_run" },
      experience: { agent_ends_call: "clean", error_handled: "clean", spoken_format: "clean" },
    });
    expect(results[0].actual.contracts).toEqual(results[0].expected.contracts);
  });

  it("carries what the text shows: when and with what the call was pinned, and its note", () => {
    const [r] = checkPins([entry(failedPin("call_8f2a9c", "nurse transfer promised, never made"))], analyzeRetellCall);
    expect([r.callId, r.pinnedAt, r.pinnedWith, r.note]).toEqual(["call_8f2a9c", "2026-11-08T10:15:00-05:00", "0.1.0", "nurse transfer promised, never made"]);
    expect(checkPins([entry(failedPin())], analyzeRetellCall)[0].note).toBeNull();
  });

  it("a changed verdict is changed, with the verdict in the changes", () => {
    const pin = edited(failedPin(), { verdict: "needs_review", contracts: {}, experience: {} });
    const [r] = checkPins([entry(pin)], analyzeRetellCall);
    expect(r.status).toBe("changed");
    expect(r.changes).toEqual([{ what: "verdict", name: "verdict", was: "needs_review", now: "failed" }]);
  });

  it("a changed contract is changed even when the verdict still matches (not only a locked verdict fails)", () => {
    const pin = failedPin();
    const [r] = checkPins([entry(edited(pin, { contracts: { ...pin.expect.contracts, transfer_kept: "unverified" } }))], analyzeRetellCall);
    expect(r.actual.verdict).toBe(pin.expect.verdict);
    expect(r.status).toBe("changed");
    expect(r.changes).toEqual([{ what: "contract", name: "transfer_kept", was: "unverified", now: "violated" }]);
  });

  it("a changed experience check is changed even when the verdict and contracts match", () => {
    const pin = passedPin();
    const [r] = checkPins([entry(edited(pin, { experience: { ...pin.expect.experience, spoken_format: "clean" } }))], analyzeRetellCall);
    expect(r.status).toBe("changed");
    expect(r.changes).toEqual([{ what: "experience", name: "spoken_format", was: "clean", now: "problem" }]);
  });

  it("no report (no content, or an engine error) is changed: the verdict and every kept item read as no report", () => {
    const pin = failedPin();
    const noContent: Analyze = (raw) => ({ kind: "no_content", callId: (raw as { call_id: string }).call_id, reason: "no_transcript" });
    const [a] = checkPins([entry(pin)], noContent);
    expect(a.status).toBe("changed");
    expect(a.actual.verdict).toBe("no_content");
    expect(a.changes[0]).toEqual({ what: "verdict", name: "verdict", was: "failed", now: "no_content" });
    expect(a.changes.map((c) => c.now).slice(1).every((n) => n === "no_report")).toBe(true);
    expect(a.changes).toHaveLength(1 + 4 + 3);

    const broken: Analyze = () => {
      throw new Error("boom");
    };
    const [b] = checkPins([entry(pin)], broken);
    expect(b.status).toBe("changed");
    expect(b.actual.verdict).toBe("error");
    expect(b.message).toContain("boom");
  });

  it("a pin that keeps only a verdict is not changed by a contract it did not keep", () => {
    const pin = edited(failedPin(), { contracts: undefined, experience: undefined });
    const [r] = checkPins([entry(pin)], analyzeRetellCall);
    expect([r.status, r.expected.contracts, r.actual.contracts]).toEqual(["held", {}, {}]);
  });

  it("reads each record in the zone it was pinned in", () => {
    const seen: string[] = [];
    const spy: Analyze = (raw, opts) => {
      seen.push(opts.tz);
      return analyzeRetellCall(raw, opts);
    };
    checkPins([entry(failedPin())], spy);
    expect(seen).toEqual(["America/New_York"]);
  });
});

describe("duplicateIds", () => {
  it("names an id that two entries share, once", () => {
    expect(duplicateIds([failedPin(), passedPin(), failedPin(), failedPin()].map(entry))).toEqual([failedPin().id]);
    expect(duplicateIds([failedPin(), passedPin()].map(entry))).toEqual([]);
  });
});
