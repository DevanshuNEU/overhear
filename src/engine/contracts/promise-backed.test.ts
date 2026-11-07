// @vitest-environment node
// promise_backed (6.4 item 1): every completion claim needs a matching successful change before it. Each case builds
// a call, runs the real pipeline pieces (resolveOk, the speech detector, changes) and asserts the result and the exact
// finding text. Every output is also wrapped in a minimal report and validated by the report schema.
import { describe, expect, it } from "vitest";
import { REASON_LINE, headlineFor } from "@/report/labels";
import { SAMPLE_REPORTS, failedSample, needsReviewSample, passedSample } from "@/report/samples";
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
import preset from "../presets/northwind-clinic.json";
import { resolveOk } from "../resolve-ok";
import { assertValidReport, ev, type ItemSpec } from "../testing/build";
import { GAP_DETAIL } from "../wording";
import type { ContractContext } from "./common";
import { promiseBacked } from "./promise-backed";

const PRESET: Policy = PolicySchema.parse(preset);

const agent = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const caller = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "caller", text, startSec, interrupted: null });
const call = (id: string, name: string, args: Record<string, unknown> = {}): ItemSpec => ({ kind: "tool_call", id, name, args });
/** A result with the platform's own success flag: true unless said otherwise. */
const result = (id: string, payload: unknown, platformOk: boolean | null = true): ItemSpec => ({ kind: "tool_result", id, ok: null, platformOk, payload });
/** A tool call and its result, side by side. */
const tool = (id: string, name: string, payload: unknown, platformOk: boolean | null = true): ItemSpec[] => [call(id, name), result(id, payload, platformOk)];
/** An availability lookup, so the record has tool calls and "nothing was attempted" is provable. */
const lookup = (): ItemSpec[] => tool("tc_look", "check_availability", { slots: [] });

const BOOKED = "You're booked for Friday at 2 PM.";

/** The report a contract result would sit in, with everything else as it would be with nothing to say. */
function minimalReport(e: Evidence, policy: Policy, detections: Detection[], promise: ContractResult): CallReport {
  const transferClaim = detections.find((d) => d.cls === "transfer");
  const transfer: ContractResult = transferClaim
    ? {
        contract: "transfer_kept",
        result: "violated",
        findings: [{ result: "violated", text: "x", said: [transferClaim.seq], did: [], asked: [], gaps: [], fields: [] }],
      }
    : { contract: "transfer_kept", result: "not_applicable", findings: [] };
  const results: ContractResult[] = [
    promise,
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

/** Runs promise_backed the way the pipeline will, then checks the output against the report schema. */
function run(input: Evidence, policy: Policy = PRESET): Run {
  const evidence = resolveOk(input, policy);
  const ctx: ContractContext = {
    ev: evidence,
    policy,
    policySource: "preset",
    tz: "UTC",
    policyTz: true,
    detections: detectAll(evidence, Object.keys(policy.tools)),
    changes: changes(evidence, policy),
    providerNames: providerNames(evidence, policy),
  };
  const out = promiseBacked(ctx);
  assertValidReport(minimalReport(evidence, policy, ctx.detections, out));
  return { out, finding: out.findings[0], evidence };
}

describe("promise_backed", () => {
  describe("not applicable", () => {
    it("is not applicable when nobody completed anything", () => {
      const r = run(ev([agent("Hello, how can I help?", 1), caller("I'd like to book.", 4), ...lookup(), agent("Would Friday at 2 PM work?", 9)]));
      expect(r.out).toEqual({ contract: "promise_backed", result: "not_applicable", findings: [] });
    });

    it("a transfer claim or a deferral is ignored", () => {
      const transfer = run(ev([...lookup(), agent("I'll transfer you to a nurse now.", 9)]));
      expect(transfer.out.result).toBe("not_applicable");
      const deferral = run(ev([...lookup(), agent("Please try again shortly, or I can help once it's back online.", 9)]));
      expect(deferral.out.result).toBe("not_applicable");
      expect(deferral.out.findings).toEqual([]);
    });
  });

  describe("passed", () => {
    it("passes when the change succeeded and its result came before the claim", () => {
      const r = run(ev([agent("Booking that now.", 5), ...tool("tc_1", "book_appointment", { ok: true }), agent(BOOKED, 12)]));
      expect(r.out.result).toBe("passed");
      expect(r.out.findings).toEqual([
        {
          result: "passed",
          text: 'At 0:12 the agent said "You\'re booked for Friday at 2 PM". The booking succeeded before that.',
          said: [4],
          did: [2, 3],
          asked: [],
          gaps: [],
          fields: [],
        },
      ]);
    });

    it("says the claim's own kind of change", () => {
      const cancel = run(ev([...tool("tc_1", "cancel_appointment", { ok: true }), agent("Your appointment is cancelled.", 30)]));
      expect(cancel.finding.text).toBe('At 0:30 the agent said "Your appointment is cancelled". The cancellation succeeded before that.');
      const update = run(
        ev(
          [...tool("tc_1", "update_details", { ok: true }), agent("Your appointment has been updated.", 30)],
        ),
        PolicySchema.parse({ ...preset, tools: { ...preset.tools, update_details: { role: "change", kind: "update" } } }),
      );
      expect(update.finding.text).toContain("The update succeeded before that.");
    });

    it("an unresolved_committed_detail gap on the change leaves it passed", () => {
      const r = run(
        ev([...tool("tc_1", "book_appointment", { ok: true }), agent(BOOKED, 12)], {
          gaps: [{ code: "unresolved_committed_detail", detail: "The date can't be found.", seqs: [1, 2], tool: "book_appointment", field: "date", kind: "book" }],
        }),
      );
      expect(r.out.result).toBe("passed");
      expect(r.finding.gaps).toEqual([]);
    });

    it("the most recent matching change decides: a failed try followed by a success passes", () => {
      const r = run(
        ev([
          ...tool("tc_1", "book_appointment", { ok: false, error: "slot taken" }),
          ...tool("tc_2", "book_appointment", { ok: true }),
          agent(BOOKED, 40),
        ]),
      );
      expect(r.out.result).toBe("passed");
      expect(r.finding.did).toEqual([3, 4]);
    });
  });

  describe("violated", () => {
    it("is violated when no change was attempted", () => {
      const r = run(ev([...lookup(), agent(BOOKED, 40)]));
      expect(r.out.result).toBe("violated");
      expect(r.finding).toEqual({
        result: "violated",
        text: 'At 0:40 the agent said "You\'re booked for Friday at 2 PM". No booking was attempted.',
        said: [3],
        did: [],
        asked: [],
        gaps: [],
        fields: [],
      });
    });

    it("is violated when the change is of another kind", () => {
      const r = run(ev([...tool("tc_1", "cancel_appointment", { ok: true }), agent(BOOKED, 40)]));
      expect(r.finding.text).toBe('At 0:40 the agent said "You\'re booked for Friday at 2 PM". No booking was attempted.');
    });

    it("is violated when the change failed, with its error", () => {
      const r = run(ev([...tool("tc_1", "book_appointment", { ok: false, error: "That slot was just taken." }), agent(BOOKED, 40)]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toBe('At 0:40 the agent said "You\'re booked for Friday at 2 PM". The booking failed: That slot was just taken.');
      expect(r.finding.did).toEqual([1, 2]);
    });

    it("a failed change with no readable error says no reason was given", () => {
      const none = run(ev([...tool("tc_1", "book_appointment", { ok: false }), agent(BOOKED, 40)]));
      expect(none.finding.text).toMatch(/The booking failed: no reason given\.$/);
      const notText = run(ev([...tool("tc_1", "book_appointment", { ok: false, error: { code: 409 } }), agent(BOOKED, 40)]));
      expect(notText.finding.text).toMatch(/The booking failed: no reason given\.$/);
    });

    it("a platform failure is a failure too", () => {
      const r = run(ev([...tool("tc_1", "book_appointment", { error: "boom" }, false), agent(BOOKED, 40)]));
      expect(r.finding.text).toMatch(/The booking failed: boom\.$/);
    });

    it('a claim before the result is violated with "The booking hadn\'t finished yet"', () => {
      const r = run(ev([call("tc_1", "book_appointment"), agent(BOOKED, 40), result("tc_1", { ok: true })]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toBe('At 0:40 the agent said "You\'re booked for Friday at 2 PM". The booking hadn\'t finished yet.');
      expect(r.finding.did).toEqual([1, 3]);
    });

    it("a change that never returned is violated the same way", () => {
      const r = run(ev([call("tc_1", "book_appointment"), agent(BOOKED, 40)]));
      expect(r.finding.text).toMatch(/The booking hadn't finished yet\.$/);
      expect(r.finding.did).toEqual([1]);
    });

    it("a result that came after the claim is unfinished even when it failed", () => {
      const r = run(ev([call("tc_1", "book_appointment"), agent(BOOKED, 40), result("tc_1", { ok: false, error: "late" })]));
      expect(r.finding.text).toMatch(/The booking hadn't finished yet\.$/);
    });

    it("the most recent matching change decides: a success followed by a failed try is violated", () => {
      const r = run(
        ev([
          ...tool("tc_1", "book_appointment", { ok: true }),
          ...tool("tc_2", "book_appointment", { ok: false, error: "double booked" }),
          agent(BOOKED, 40),
        ]),
      );
      expect(r.finding.text).toMatch(/The booking failed: double booked\.$/);
      expect(r.finding.did).toEqual([3, 4]);
    });

    it("a tool the policy doesn't describe might have been the booking, so the claim is unverified, not violated", () => {
      const r = run(ev([...tool("tc_1", "make_appointment", { ok: true }), agent(BOOKED, 40)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding).toEqual({
        result: "unverified",
        text: "Couldn't check promises backed by the system: the call used make_appointment, which the policy doesn't describe, so we couldn't tell whether it was the booking.",
        said: [3],
        did: [1],
        asked: [],
        gaps: [],
        fields: [],
      });
    });

    it("names every undescribed tool used before the claim, once each", () => {
      const r = run(
        ev([...tool("tc_1", "make_appointment", { ok: true }), ...lookup(), ...tool("tc_3", "set_appointment", {}), call("tc_4", "make_appointment"), agent(BOOKED, 40)]),
      );
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toBe(
        "Couldn't check promises backed by the system: the call used make_appointment and set_appointment, which the policy doesn't describe, so we couldn't tell whether any of them was the booking.",
      );
    });

    it("a described change of another kind does not hide an undescribed tool", () => {
      const r = run(ev([...tool("tc_1", "cancel_appointment", { ok: true }), ...tool("tc_2", "make_appointment", { ok: true }), agent(BOOKED, 40)]));
      expect(r.out.result).toBe("unverified");
    });

    it("an undescribed tool used only after the claim leaves it violated", () => {
      const r = run(ev([...lookup(), agent(BOOKED, 40), ...tool("tc_2", "make_appointment", { ok: true })]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toMatch(/No booking was attempted\.$/);
    });

    it("a backend action on an undescribed tool counts too", () => {
      const action: ItemSpec = { kind: "backend_action", id: "ba_1", toolCallId: "tc_look", tool: "make_appointment", args: {}, result: {}, ok: true, ts: "t", link: { toolCallId: "tc_look", by: "tool_call_id" } };
      const r = run(ev([...lookup(), action, agent(BOOKED, 40)], { tier: 2 }));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toContain("the call used make_appointment, which the policy doesn't describe");
    });

    it("a claim made before the change was first tried does not say none was attempted at all", () => {
      const r = run(ev([...lookup(), agent(BOOKED, 5), ...tool("tc_1", "book_appointment", { ok: true })]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toBe('At 0:05 the agent said "You\'re booked for Friday at 2 PM". No booking was attempted before that.');
      expect(r.finding.did).toEqual([]);
    });
  });

  describe("unverified", () => {
    it("is unverified when the change's success is unknown", () => {
      const r = run(ev([...tool("tc_1", "book_appointment", {}, null), agent(BOOKED, 40)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding).toEqual({
        result: "unverified",
        text: "Couldn't check promises backed by the system: the book_appointment result doesn't say whether it worked.",
        said: [3],
        did: [1, 2],
        asked: [],
        gaps: ["unknown_success"],
        fields: [],
      });
    });

    it("is unverified when a gap touches the claim, the call or its result", () => {
      for (const seqs of [[1], [2], [3]]) {
        const r = run(
          ev([...tool("tc_1", "book_appointment", { ok: true }), agent(BOOKED, 40)], {
            gaps: [{ code: "evidence_conflict", detail: "d", seqs, tool: "book_appointment" }],
          }),
        );
        expect(r.out.result, `seqs ${seqs}`).toBe("unverified");
        expect(r.finding.gaps).toEqual(["evidence_conflict"]);
        expect(r.finding.text).toBe(
          "Couldn't check promises backed by the system: the backend log and the call record disagree about book_appointment.",
        );
      }
    });

    it("a gap beats a failure it touches: nothing is violated on shaky evidence", () => {
      const r = run(
        ev([...tool("tc_1", "book_appointment", { ok: false, error: "x" }), agent(BOOKED, 40)], {
          gaps: [{ code: "ambiguous_link", detail: "d", seqs: [2] }],
        }),
      );
      expect(r.out.result).toBe("unverified");
    });

    it("a model that disagrees with the code about the claim leaves it unverified", () => {
      const r = run(
        ev([...tool("tc_1", "book_appointment", { ok: true }), agent(BOOKED, 40)], {
          gaps: [{ code: "llm_code_disagreement", detail: "d", seqs: [3] }],
        }),
      );
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual(["llm_code_disagreement"]);
      expect(r.finding.text).toBe("Couldn't check promises backed by the system: the model and the code read this turn differently.");
    });

    it("a gap elsewhere in the call does not touch the finding", () => {
      const r = run(
        ev([...tool("tc_1", "check_availability", { slots: [] }), ...tool("tc_2", "book_appointment", { ok: true }), agent(BOOKED, 40)], {
          gaps: [{ code: "ambiguous_link", detail: "d", seqs: [2] }],
        }),
      );
      expect(r.out.result).toBe("passed");
    });

    it("ordering none is unverified, never violated", () => {
      const items = [...lookup(), agent(BOOKED, 40)];
      const none = run(ev(items, { ordering: "none" }));
      expect(none.out.result).toBe("unverified");
      expect(none.finding.text).toBe("Couldn't check promises backed by the system: the call record doesn't say what happened first.");
      const failedChange = run(ev([...tool("tc_1", "book_appointment", { ok: false }), agent(BOOKED, 40)], { ordering: "none" }));
      expect(failedChange.out.result).toBe("unverified");
      const backed = run(ev([...tool("tc_1", "book_appointment", { ok: true }), agent(BOOKED, 40)], { ordering: "none" }));
      expect(backed.out.result).toBe("unverified");
      expect(backed.finding.did).toEqual([1, 2]);
    });

    it("timestamp ordering is trusted like sequence ordering", () => {
      const r = run(ev([...tool("tc_1", "book_appointment", { ok: true }), agent(BOOKED, 40)], { ordering: "timestamps" }));
      expect(r.out.result).toBe("passed");
    });

    it('with no tool calls in the record, an unbacked "you\'re booked" is unverified with missing_tool_transcript', () => {
      const r = run(ev([agent(BOOKED, 40)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding).toEqual({
        result: "unverified",
        text: "Couldn't check promises backed by the system: the call record has no tool calls.",
        said: [1],
        did: [],
        asked: [],
        gaps: ["missing_tool_transcript"],
        fields: [],
      });
      expect(r.evidence.gaps).toEqual([{ code: "missing_tool_transcript", detail: GAP_DETAIL.missing_tool_transcript, seqs: [] }]);
    });

    it("a Retell record with no tool transcript says the same, once, and does not duplicate the adapter's gap", () => {
      const adapterGap = { code: "missing_tool_transcript" as const, detail: "from the adapter", seqs: [] };
      const r = run(ev([agent(BOOKED, 40)], { ordering: "none", gaps: [adapterGap] }));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toBe("Couldn't check promises backed by the system: the call record has no tool calls.");
      expect(r.evidence.gaps).toEqual([adapterGap]);
    });
  });

  describe("claims", () => {
    it("a reschedule claim matches a cancel followed by a book", () => {
      const r = run(
        ev([
          ...tool("tc_1", "cancel_appointment", { ok: true }),
          ...tool("tc_2", "book_appointment", { ok: true }),
          agent("I've rescheduled your appointment to Friday at 3 PM.", 50),
        ]),
      );
      expect(r.out.result).toBe("passed");
      expect(r.finding.text).toBe(
        'At 0:50 the agent said "I\'ve rescheduled your appointment to Friday at 3 PM". The reschedule succeeded before that.',
      );
      expect(r.finding.did).toEqual([1, 2, 3, 4]);
    });

    it("a cancel and a book that does not work breaks the reschedule", () => {
      const r = run(
        ev([
          ...tool("tc_1", "cancel_appointment", { ok: true }),
          ...tool("tc_2", "book_appointment", { ok: false, error: "no openings" }),
          agent("I've rescheduled your appointment to Friday at 3 PM.", 50),
        ]),
      );
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toMatch(/The reschedule failed: no openings\.$/);
      expect(r.finding.did).toEqual([1, 2, 3, 4]);
    });

    it("a book before the cancel is not a reschedule", () => {
      const r = run(
        ev([
          ...tool("tc_1", "book_appointment", { ok: true }),
          ...tool("tc_2", "cancel_appointment", { ok: true }),
          agent("I've rescheduled your appointment to Friday at 3 PM.", 50),
        ]),
      );
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toMatch(/No reschedule was attempted\.$/);
    });

    it("a reschedule tool matches a reschedule claim", () => {
      const r = run(ev([...tool("tc_1", "reschedule_appointment", { ok: true }), agent("I've rescheduled your appointment to Friday at 3 PM.", 50)]));
      expect(r.out.result).toBe("passed");
    });

    it("a booking claim is backed by the book of a cancel and a book", () => {
      const r = run(
        ev([...tool("tc_1", "cancel_appointment", { ok: true }), ...tool("tc_2", "book_appointment", { ok: true }), agent(BOOKED, 50)]),
      );
      expect(r.out.result).toBe("passed");
      expect(r.finding.did).toEqual([3, 4]);
    });

    it("a kindless claim matches any earlier change", () => {
      const r = run(ev([...tool("tc_1", "cancel_appointment", { ok: true }), agent("You're all set.", 30)]));
      expect(r.out.result).toBe("passed");
      expect(r.finding.text).toBe('At 0:30 the agent said "You\'re all set". The cancellation succeeded before that.');
      const failed = run(ev([...tool("tc_1", "cancel_appointment", { ok: false, error: "not found" }), agent("You're all set.", 30)]));
      expect(failed.finding.text).toBe('At 0:30 the agent said "You\'re all set". The cancellation failed: not found.');
    });

    it("a kindless claim is judged on the most recent change of any kind", () => {
      const r = run(
        ev([
          ...tool("tc_1", "book_appointment", { ok: true }),
          ...tool("tc_2", "cancel_appointment", { ok: false, error: "gone" }),
          agent("You're all set.", 30),
        ]),
      );
      expect(r.finding.text).toMatch(/The cancellation failed: gone\.$/);
    });

    it("ignores a kindless claim with no change attempted", () => {
      const r = run(
        ev([
          ...tool("tc_1", "verify_patient", { verified: true, patientId: "pt-1" }),
          agent("You're all set. What else can I help with?", 20),
        ]),
      );
      expect(r.out).toEqual({ contract: "promise_backed", result: "not_applicable", findings: [] });
    });

    it("ignores a kindless claim made before any change was attempted, even if one follows", () => {
      const r = run(ev([...lookup(), agent("You're all set.", 20), ...tool("tc_1", "book_appointment", { ok: true })]));
      expect(r.out.result).toBe("not_applicable");
    });

    it("a kindless claim with no change in a record with no tool calls is ignored too", () => {
      const r = run(ev([agent("You're all set.", 20)]));
      expect(r.out.result).toBe("not_applicable");
      expect(r.evidence.gaps).toEqual([]);
    });

    it("a change attempted but never answered counts as attempted for a kindless claim", () => {
      const r = run(ev([call("tc_1", "book_appointment"), agent("You're all set.", 20)]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toMatch(/The booking hadn't finished yet\.$/);
    });

    it("a change tool the policy gives no kind backs a claim of any kind", () => {
      const policy = PolicySchema.parse({ ...preset, tools: { ...preset.tools, do_it: { role: "change" } } });
      const booked = run(ev([...tool("tc_1", "do_it", { ok: true }), agent(BOOKED, 20)]), policy);
      expect(booked.finding.text).toBe('At 0:20 the agent said "You\'re booked for Friday at 2 PM". The booking succeeded before that.');
      const allSet = run(ev([...tool("tc_1", "do_it", { ok: true }), agent("You're all set.", 20)]), policy);
      expect(allSet.finding.text).toBe('At 0:20 the agent said "You\'re all set". The change succeeded before that.');
    });
  });

  describe("findings", () => {
    it("makes one finding per agent turn, not one per detection", () => {
      const r = run(
        ev([...tool("tc_1", "book_appointment", { ok: true }), agent("You're all set, Sofia. Your appointment with Dr. Nair is confirmed for Friday at 2 PM.", 70)]),
      );
      expect(r.out.findings).toHaveLength(1);
      expect(r.finding.said).toEqual([3]);
      expect(r.finding.text).toBe(
        'At 1:10 the agent said "Your appointment with Dr. Nair is confirmed for Friday at 2 PM". The booking succeeded before that.',
      );
    });

    it("takes the worst of the claims in one turn", () => {
      const r = run(ev([...tool("tc_1", "book_appointment", { ok: true }), agent("You're booked for Friday at 2 PM. Your old appointment is cancelled.", 70)]));
      expect(r.out.findings).toHaveLength(1);
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toBe('At 1:10 the agent said "Your old appointment is cancelled". No cancellation was attempted.');
    });

    it("one finding for each turn that claims, in call order, and the result is the worst of them", () => {
      const r = run(
        ev([
          ...tool("tc_1", "book_appointment", { ok: true }),
          agent(BOOKED, 40),
          caller("Thanks. Please cancel my other one.", 50),
          agent("Your other appointment is cancelled.", 60),
        ]),
      );
      expect(r.out.findings.map((f) => [f.said, f.result])).toEqual([
        [[3], "passed"],
        [[5], "violated"],
      ]);
      expect(r.out.result).toBe("violated");
    });

    it("shows an unstarted turn as turn n", () => {
      const r = run(ev([...lookup(), caller("Hi"), agent(BOOKED)]));
      expect(r.finding.text).toBe('At turn 2 the agent said "You\'re booked for Friday at 2 PM". No booking was attempted.');
    });

    it("never cites a turn in did, and never a caller turn in said", () => {
      const r = run(ev([...tool("tc_1", "book_appointment", { ok: true }), caller("Great."), agent(BOOKED, 40)]));
      expect(r.finding.did.every((s) => r.evidence.items[s - 1].kind !== "turn")).toBe(true);
      expect(r.finding.said.every((s) => r.evidence.items[s - 1].kind === "turn")).toBe(true);
    });
  });

  describe("the sample calls", () => {
    it.each([
      ["failed", failedSample],
      ["passed", passedSample],
      ["needs-review", needsReviewSample],
    ])("%s: matches the sample's promise_backed result", (_name, sample) => {
      const expected = sample.results.find((r) => r.contract === "promise_backed")!;
      const out = run(sample.evidence, sample.policy).out;
      expect(out).toEqual(expected);
    });

    it("the failed sample has two completion detections at one turn and one finding", () => {
      const at = failedSample.detections.filter((d) => d.cls === "completion" && d.seq === 25);
      expect(at).toHaveLength(2);
      expect(run(failedSample.evidence, failedSample.policy).out.findings).toHaveLength(1);
    });

    it("covers every sample", () => {
      expect(SAMPLE_REPORTS).toHaveLength(3);
    });
  });
});
