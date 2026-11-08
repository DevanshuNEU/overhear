// @vitest-environment node
// transfer_kept (6.4 item 4): when the agent says it is transferring the caller, a transfer must be attempted and must
// succeed. Each case builds a call, runs the real pipeline pieces (resolveOk, the speech detector, changes) and
// asserts the result and the exact finding text. Every output is also wrapped in a minimal report and validated by
// the report schema.
import { describe, expect, it } from "vitest";
import { REASON_LINE, headlineFor } from "@/report/labels";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import {
  PolicySchema,
  type CallReport,
  type ContractResult,
  type Detection,
  type Evidence,
  type Finding,
  type Policy,
  type ReviewReason,
} from "@/report/schema";
import { changes, providerNames } from "../committed";
import { detectAll } from "../detect-speech";
import { policyFor } from "../policy";
import preset from "../presets/northwind-clinic.json";
import { resolveOk } from "../resolve-ok";
import { assertValidReport, ev, type ItemSpec } from "../testing/build";
import { GAP_DETAIL } from "../wording";
import type { ContractContext } from "./common";
import { transferKept } from "./transfer-kept";

const PRESET: Policy = PolicySchema.parse(preset);
/** The preset with a transfer tool, so a transfer call is one the policy describes. */
const WITH_TRANSFER: Policy = PolicySchema.parse({ ...preset, tools: { ...preset.tools, transfer_call: { role: "transfer" } } });

const agent = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const caller = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "caller", text, startSec, interrupted: null });
const call = (id: string, name: string, args: Record<string, unknown> = {}): ItemSpec => ({ kind: "tool_call", id, name, args });
/** A result with the platform's own success flag: true unless said otherwise. */
const result = (id: string, payload: unknown, platformOk: boolean | null = true): ItemSpec => ({ kind: "tool_result", id, ok: null, platformOk, payload });
const tool = (id: string, name: string, payload: unknown, platformOk: boolean | null = true): ItemSpec[] => [call(id, name), result(id, payload, platformOk)];
const target = (): ItemSpec => ({ kind: "event", type: "transfer_target", data: { content: "Nurse line, this is Morgan." } });
/** An availability lookup, so the record has tool calls and "nothing was attempted" is provable. */
const lookup = (): ItemSpec[] => tool("tc_look", "check_availability", { slots: [] });

const CLAIM = "I'll transfer you to a nurse now.";
const NOT_ATTEMPTED = "At 0:09 the agent said it was transferring the caller. No transfer was attempted.";

/** The report a contract result would sit in, with everything else as it would be with nothing to say. */
function minimalReport(e: Evidence, policy: Policy, detections: Detection[], transfer: ContractResult): CallReport {
  const results: ContractResult[] = [
    { contract: "promise_backed", result: "not_applicable", findings: [] },
    { contract: "spoken_matches_committed", result: "not_applicable", findings: [] },
    transfer,
    { contract: "committed_matches_request", result: "not_run", findings: [] },
    ...(policy.packs.includes("healthcare") ? [{ contract: "verified_before_change" as const, result: "not_applicable" as const, findings: [] }] : []),
  ];
  const failed = results.some((r) => r.result === "violated");
  const reasons: ReviewReason[] = [];
  for (const r of results.filter((x) => x.result === "unverified")) {
    reasons.push({ kind: "unverified_result", contract: r.contract, text: REASON_LINE.unverified_result, seqs: [] });
  }
  if (detections.some((d) => d.cls === "deferral")) reasons.push({ kind: "deferral", text: REASON_LINE.deferral, seqs: [] });
  const verdict = failed ? "failed" : reasons.length > 0 ? "needs_review" : "passed";
  const kept = results.filter((r) => r.result !== "not_run");
  const notes: CallReport["notes"] =
    verdict === "passed" ? [...(kept.every((r) => r.result === "not_applicable") ? (["no_promises_made"] as const) : []), "request_not_checked"] : [];
  const shown = verdict === "needs_review" ? reasons : [];
  return {
    schemaVersion: 1,
    callId: e.callId,
    platform: e.platform,
    verdict,
    notes,
    headline: headlineFor(verdict, notes, shown),
    reasons: shown,
    experience: { ran: [], problems: [] },
    results,
    detections,
    llmUsed: false,
    request: null,
    requestSource: null,
    timezone: "UTC",
    policy,
    evidence: e,
  };
}

interface Run {
  out: ContractResult;
  /** The finding of a result with exactly one. */
  finding: Finding;
  /** The evidence the contract ran on, after resolveOk and anything the contract added to its gaps. */
  evidence: Evidence;
}

/** Runs transfer_kept the way the pipeline will, then checks the output against the report schema. */
function runWith(input: Evidence, policy: Policy, policySource: "preset" | "inferred"): Run {
  const evidence = resolveOk(input, policy);
  const ctx: ContractContext = {
    ev: evidence,
    policy,
    policySource,
    tz: "UTC",
    policyTz: true,
    detections: detectAll(evidence, Object.keys(policy.tools)),
    changes: changes(evidence, policy),
    providerNames: providerNames(evidence, policy),
  };
  const out = transferKept(ctx);
  assertValidReport(minimalReport(evidence, policy, ctx.detections, out));
  return { out, finding: out.findings[0], evidence };
}

/** The Northwind preset with a transfer tool: the agent's tools are known. */
const run = (input: Evidence, policy: Policy = WITH_TRANSFER): Run => runWith(input, policy, "preset");

describe("transfer_kept", () => {
  describe("not applicable", () => {
    it("an offer alone is not applicable", () => {
      const r = run(ev([...lookup(), agent("I can transfer you to a nurse if you'd like.", 9)]));
      expect(r.out).toEqual({ contract: "transfer_kept", result: "not_applicable", findings: [] });
    });

    it("a call with no transfer talk is not applicable", () => {
      const r = run(ev([agent("Hello, how can I help?", 1), caller("I'd like to book.", 4), ...lookup(), agent("Would Friday at 2 PM work?", 9)]));
      expect(r.out).toEqual({ contract: "transfer_kept", result: "not_applicable", findings: [] });
    });

    it("a conditional or a deferred transfer is not a claim", () => {
      const r = run(ev([...lookup(), agent("I'll transfer you if needed.", 9), agent("I'll transfer you once the system is back.", 12)]));
      expect(r.out.result).toBe("not_applicable");
    });

    it("a completion claim alone is not applicable", () => {
      const r = run(ev([...lookup(), agent("You're booked for Friday at 2 PM.", 9)]));
      expect(r.out.result).toBe("not_applicable");
    });
  });

  describe("passed", () => {
    it("a claim then a successful transfer passes", () => {
      const r = run(ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { ok: true })]));
      expect(r.out.result).toBe("passed");
      expect(r.out.findings).toEqual([
        {
          result: "passed",
          text: "At 0:09 the agent said it was transferring the caller. The transfer went through.",
          said: [1],
          did: [2, 3],
          asked: [],
          gaps: [],
          fields: [],
        },
      ]);
    });

    it("a transfer call before the claim backs it", () => {
      const r = run(ev([...tool("tc_1", "transfer_call", { ok: true }), agent("Transferring you to a nurse now.", 9)]));
      expect(r.out.result).toBe("passed");
      expect(r.finding.did).toEqual([1, 2]);
    });

    it("a transfer with no result passes when a transfer_target event shows the caller was connected", () => {
      const r = run(ev([agent(CLAIM, 9), call("tc_1", "transfer_call"), target()]));
      expect(r.out.result).toBe("passed");
      expect(r.finding.did).toEqual([2, 3]);
    });

    it("a transfer_target event alone shows a transfer happened, even with no transfer tool in the policy", () => {
      const r = run(ev([...lookup(), agent(CLAIM, 9), target()]), PRESET);
      expect(r.out.result).toBe("passed");
      expect(r.finding.did).toEqual([4]);
    });

    it("a result that does not say whether the transfer worked passes when a transfer_target event shows the caller was connected", () => {
      const r = run(ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { note: "queued" }, null), target()]));
      expect(r.out.result).toBe("passed");
      expect(r.finding).toEqual({
        result: "passed",
        text: "At 0:09 the agent said it was transferring the caller. The transfer went through.",
        said: [1],
        did: [2, 4],
        asked: [],
        gaps: [],
        fields: [],
      });
      // The gap stays in the evidence: it is true of the result, it just does not decide this finding.
      expect(r.evidence.gaps.map((g) => g.code)).toEqual(["unknown_success"]);
    });

    it("an unknown_success gap on a result no event stands in for still makes the claim unverified", () => {
      const r = run(ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { note: "queued" }, null)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual(["unknown_success"]);
    });

    it("a retry that worked passes after a failed first try", () => {
      const r = run(
        ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { ok: false, error: "busy" }), ...tool("tc_2", "transfer_call", { ok: true })]),
      );
      expect(r.out.result).toBe("passed");
      expect(r.finding.did).toEqual([4, 5]);
    });

    it("a transfer result Retell reports as a success is a success when the policy has no success path", () => {
      const noPath = PolicySchema.parse({ packs: ["scheduling"], tools: { transfer_call: { role: "transfer" } }, fields: {} });
      const r = runWith(ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { status: "connected" })]), noPath, "inferred");
      expect(r.out.result).toBe("passed");
    });
  });

  describe("violated", () => {
    it("a claim with no transfer call is violated", () => {
      const r = run(ev([...lookup(), agent(CLAIM, 9)]));
      expect(r.out.result).toBe("violated");
      expect(r.finding).toEqual({ result: "violated", text: NOT_ATTEMPTED, said: [3], did: [], asked: [], gaps: [], fields: [] });
    });

    it("a failed transfer is violated", () => {
      const r = run(ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { ok: false, error: "no answer" })]));
      expect(r.out.result).toBe("violated");
      expect(r.finding).toEqual({
        result: "violated",
        text: "At 0:09 the agent said it was transferring the caller. The transfer failed.",
        said: [1],
        did: [2, 3],
        asked: [],
        gaps: [],
        fields: [],
      });
    });

    it("a failed transfer by the platform's own flag is violated", () => {
      const r = run(ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { status: "connected" }, false)]));
      expect(r.finding.text).toContain("The transfer failed.");
    });

    it("a transfer_target event is ignored when the result's ok is false", () => {
      const r = run(ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { ok: false }), target()]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toContain("The transfer failed.");
    });

    it("a failed transfer before the claim, with nothing after it, still fails the claim", () => {
      const r = run(ev([...tool("tc_1", "transfer_call", { ok: false }), agent("Transferring you to a nurse now.", 9)]));
      expect(r.finding.text).toContain("The transfer failed.");
    });

    it("spoken tool syntax is violated, with or without a claim", () => {
      const r = run(ev([...lookup(), agent("Sure. transfer_call(to: nurse)", 9)]));
      expect(r.out.result).toBe("violated");
      expect(r.out.findings).toEqual([
        {
          result: "violated",
          text: 'At 0:09 the agent read out a tool command: "transfer_call(".',
          said: [3],
          did: [],
          asked: [],
          gaps: [],
          fields: [],
        },
      ]);
    });

    it("spoken tool syntax stays violated when the record has no tool calls to read", () => {
      const r = run(ev([agent("Let me do that: transfer_call(to: nurse)", 9)]));
      expect(r.out.result).toBe("violated");
    });

    it("a claim and tool syntax in one turn give two findings, the claim first", () => {
      const r = run(ev([...lookup(), agent("I'll transfer you to a nurse now. transfer_call(to: nurse)", 9)]));
      expect(r.out.findings.map((f) => f.text)).toEqual([NOT_ATTEMPTED, 'At 0:09 the agent read out a tool command: "transfer_call(".']);
    });

    it("a claim with a transfer tool known to the policy but never called is violated", () => {
      const r = runWith(ev([...tool("tc_look", "check_slots", { slots: [] }), agent(CLAIM, 9)]), WITH_TRANSFER, "inferred");
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toBe(NOT_ATTEMPTED);
    });
  });

  describe("one finding per claim", () => {
    it("two claims in two turns give two findings", () => {
      const r = run(ev([...lookup(), agent(CLAIM, 9), caller("Okay.", 12), agent("Transferring you to a nurse now.", 20)]));
      expect(r.out.findings.map((f) => f.said)).toEqual([[3], [5]]);
      expect(r.out.findings.map((f) => f.text)).toEqual([
        NOT_ATTEMPTED,
        "At 0:20 the agent said it was transferring the caller. No transfer was attempted.",
      ]);
    });

    it("two claims in one turn are one claim", () => {
      const r = run(ev([...lookup(), agent("I'll transfer you to a nurse now. Transferring you now, please hold.", 9)]));
      expect(r.out.findings).toHaveLength(1);
    });

    it("the result is the worst of the findings", () => {
      const r = run(ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { ok: true }), agent("Transferring you to a nurse now.", 20)]));
      expect(r.out.findings.map((f) => f.result)).toEqual(["passed", "passed"]);
      const mixed = run(ev([agent("transfer_call(x)", 5), agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { ok: true })]));
      expect(mixed.out.result).toBe("violated");
    });
  });

  describe("unverified", () => {
    it("a transfer tool call with no result and no event is unverified", () => {
      const r = run(ev([agent(CLAIM, 9), call("tc_1", "transfer_call")]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding).toEqual({
        result: "unverified",
        text: "Couldn't check promised transfers happen: the transfer_call call has no result and nothing else in the record shows the caller was connected.",
        said: [1],
        did: [2],
        asked: [],
        gaps: [],
        fields: [],
      });
    });

    it("a result that does not say whether the transfer worked is unverified and cites the gap", () => {
      const r = run(ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { note: "queued" }, null)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual(["unknown_success"]);
      expect(r.finding.text).toBe("Couldn't check promised transfers happen: the transfer_call result doesn't say whether it worked.");
    });

    it("with an inferred policy and no transfer tool, a claim is unverified, not violated", () => {
      const input = ev([...tool("tc_look", "check_slots", { slots: [{ id: "s1", startsAt: "2026-11-06T14:00:00Z" }] }), agent(CLAIM, 9)]);
      const inferred = policyFor(input);
      expect(inferred.source).toBe("inferred");
      const r = runWith(input, inferred.policy, inferred.source);
      expect(r.out.result).toBe("unverified");
      expect(r.finding).toEqual({
        result: "unverified",
        text: "Couldn't check promised transfers happen: no transfer tool is known for this agent.",
        said: [3],
        did: [],
        asked: [],
        gaps: [],
        fields: [],
      });
    });

    it("with the preset, the same claim is violated", () => {
      const input = ev([...tool("tc_look", "check_availability", { slots: [{ id: "s1", startsAt: "2026-11-06T14:00:00Z" }] }), agent(CLAIM, 9)]);
      const picked = policyFor(input);
      expect(picked.source).toBe("preset");
      const r = runWith(input, picked.policy, picked.source);
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toBe(NOT_ATTEMPTED);
    });

    it("an inferred policy with no tool calls at all names the missing tool transcript, as promise_backed does", () => {
      const input = ev([agent(CLAIM, 9)]);
      const picked = policyFor(input);
      expect(picked.source).toBe("inferred");
      const r = runWith(input, picked.policy, picked.source);
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual(["missing_tool_transcript"]);
      expect(r.finding.text).toBe("Couldn't check promised transfers happen: the call record has no tool calls.");
      expect(r.evidence.gaps).toEqual([{ code: "missing_tool_transcript", detail: GAP_DETAIL.missing_tool_transcript, seqs: [] }]);
    });

    it("an inferred policy still believes a transfer_target event", () => {
      const input = ev([...tool("tc_look", "check_slots", { slots: [] }), agent(CLAIM, 9), target()]);
      const picked = policyFor(input);
      const r = runWith(input, picked.policy, picked.source);
      expect(r.out.result).toBe("passed");
    });

    it("a tool the policy does not describe after the claim might have been the transfer", () => {
      const r = run(ev([...lookup(), agent(CLAIM, 9), ...tool("tc_x", "connect_agent", { ok: true })]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding).toEqual({
        result: "unverified",
        text: "Couldn't check promised transfers happen: the call used connect_agent, which the policy doesn't describe, so we couldn't tell whether it was the transfer.",
        said: [3],
        did: [4, 5],
        asked: [],
        gaps: [],
        fields: [],
      });
    });

    it("several undescribed tools are named together", () => {
      const r = run(ev([...lookup(), agent(CLAIM, 9), call("tc_x", "connect_agent"), call("tc_y", "ring_desk")]));
      expect(r.finding.text).toBe(
        "Couldn't check promised transfers happen: the call used connect_agent and ring_desk, which the policy doesn't describe, so we couldn't tell whether any of them was the transfer.",
      );
    });

    it("an undescribed tool before the claim does not hide the absence", () => {
      const r = run(ev([...tool("tc_x", "connect_agent", { ok: true }), agent(CLAIM, 9)]));
      expect(r.out.result).toBe("violated");
    });

    it("a record with no tool calls can't prove the transfer was never attempted", () => {
      const r = run(ev([agent("Let me get you to a nurse, transferring you now.", 9)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual(["missing_tool_transcript"]);
      expect(r.finding.text).toBe("Couldn't check promised transfers happen: the call record has no tool calls.");
      expect(r.evidence.gaps).toEqual([{ code: "missing_tool_transcript", detail: GAP_DETAIL.missing_tool_transcript, seqs: [] }]);
    });

    it("a gap that touches the claim makes it unverified", () => {
      const r = run(
        ev([...lookup(), agent(CLAIM, 9)], {
          gaps: [{ code: "llm_code_disagreement", detail: "The model and the code read this turn differently.", seqs: [3] }],
        }),
      );
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual(["llm_code_disagreement"]);
    });

    it("a gap that touches a failed transfer call makes the claim unverified, not violated", () => {
      const r = run(
        ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { ok: false })], {
          gaps: [{ code: "evidence_conflict", detail: "The backend log and the call record disagree.", seqs: [2], tool: "transfer_call" }],
        }),
      );
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual(["evidence_conflict"]);
    });

    it("a gap about an unrelated booking detail does not touch a transfer", () => {
      const r = run(
        ev([...lookup(), agent(CLAIM, 9)], {
          gaps: [{ code: "unresolved_committed_detail", detail: "x", seqs: [3], tool: "book_appointment", field: "date", kind: "book" }],
        }),
      );
      expect(r.out.result).toBe("violated");
    });

    it("with ordering none, nothing is before or after anything, so a claim is unverified", () => {
      const r = run(ev([agent(CLAIM, 9), ...tool("tc_1", "transfer_call", { ok: true })], { ordering: "none" }));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toBe("Couldn't check promised transfers happen: the call record doesn't say what happened first.");
    });

    it("tool syntax with ordering none is unverified, since the report schema allows no violated finding then", () => {
      const r = run(ev([...lookup(), agent("transfer_call(to: nurse)", 9)], { ordering: "none" }));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.said).toEqual([3]);
      expect(r.finding.text).toBe("Couldn't check promised transfers happen: the call record doesn't say what happened first.");
    });
  });

  describe("the samples", () => {
    it("the failed sample's two transfer claims give two violated findings at seqs 25 and 27", () => {
      const sample = failedSample;
      const evidence = resolveOk(sample.evidence, sample.policy);
      const out = transferKept({
        ev: evidence,
        policy: sample.policy,
        policySource: policyFor(sample.evidence).source,
        tz: sample.timezone,
        policyTz: sample.policy.timezone !== undefined,
        detections: detectAll(evidence, Object.keys(sample.policy.tools)),
        changes: changes(evidence, sample.policy),
        providerNames: providerNames(evidence, sample.policy),
      });
      expect(policyFor(sample.evidence).source).toBe("preset");
      expect(out.result).toBe("violated");
      expect(out.findings.map((f) => [f.result, f.said])).toEqual([
        ["violated", [25]],
        ["violated", [27]],
      ]);
      expect(out).toEqual(sample.results.find((r) => r.contract === "transfer_kept"));
    });

    const samples: [string, CallReport][] = [
      ["passed", passedSample],
      ["needs-review", needsReviewSample],
    ];
    for (const [name, sample] of samples) {
      it(`reproduces the ${name} sample's transfer_kept result`, () => {
        const evidence = resolveOk(sample.evidence, sample.policy);
        const out = transferKept({
          ev: evidence,
          policy: sample.policy,
          policySource: policyFor(sample.evidence).source,
          tz: sample.timezone,
          policyTz: sample.policy.timezone !== undefined,
          detections: detectAll(evidence, Object.keys(sample.policy.tools)),
          changes: changes(evidence, sample.policy),
          providerNames: providerNames(evidence, sample.policy),
        });
        expect(out).toEqual(sample.results.find((r) => r.contract === "transfer_kept"));
      });
    }
  });
});
