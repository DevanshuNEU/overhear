// @vitest-environment node
// spoken_matches_committed (6.4 item 3): the first completion claim after each successful change must state what the
// change committed, field by field. Each case builds a call, runs the real pipeline pieces (resolveOk, the speech
// detector, changes, committedDetails gaps) and asserts the result, the exact finding text and the field rows. Every
// output is also wrapped in a minimal report and validated by the report schema.
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
import { changes, committedDetails, providerNames, successfulChanges } from "../committed";
import { detectAll } from "../detect-speech";
import preset from "../presets/northwind-clinic.json";
import { resolveOk } from "../resolve-ok";
import { assertValidReport, ev, type ItemSpec } from "../testing/build";
import type { ContractContext } from "./common";
import { spokenMatchesCommitted } from "./spoken-matches-committed";

const PRESET: Policy = PolicySchema.parse(preset);
// 2026-11-05 (a Thursday), so "Friday, November 6" reads as the next day.
const CALL_START = 1793911370896;

const agent = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const call = (id: string, name: string, args: Record<string, unknown> = {}): ItemSpec => ({ kind: "tool_call", id, name, args });
const result = (id: string, payload: unknown, platformOk: boolean | null = true): ItemSpec => ({ kind: "tool_result", id, ok: null, platformOk, payload });
const tool = (id: string, name: string, args: Record<string, unknown>, payload: unknown, platformOk: boolean | null = true): ItemSpec[] => [
  call(id, name, args),
  result(id, payload, platformOk),
];

interface Slot {
  id: string;
  startsAt?: string;
  providerName?: unknown;
}
const NAIR = "Dr. Priya Nair";
const slot = (id: string, startsAt: string | undefined = "2026-11-06T14:00:00.000Z", providerName: unknown = NAIR): Slot => ({ id, startsAt, providerName });
/** Two items (seqs 1 and 2): an availability lookup that lists the slots, so a change's detail can be read. */
const lookup = (slots: Slot[], id = "tc_look"): ItemSpec[] => tool(id, "check_availability", { date: "2026-11-06" }, { slots });
const book = (id: string, slotId: string, payload: unknown = { ok: true }): ItemSpec[] => tool(id, "book_appointment", { slotId }, payload);

const FRIDAY_2PM = "You're booked for Friday, November 6 at 2 PM with Dr. Nair.";
const PASSED_TEXT = "The agent confirmed Friday, November 6 at 2:00 PM with Dr. Priya Nair. That is what was committed.";

/** The report a contract result would sit in, with everything else as it would be with nothing to say. */
function minimalReport(e: Evidence, policy: Policy, detections: Detection[], spoken: ContractResult): CallReport {
  const promised = detections.some((d) => d.cls === "completion");
  const results: ContractResult[] = [
    { contract: "promise_backed", result: "not_applicable", findings: [] },
    spoken,
    { contract: "transfer_kept", result: "not_applicable", findings: [] },
    { contract: "committed_matches_request", result: "not_run", findings: [] },
    ...(policy.packs.includes("healthcare") ? [{ contract: "verified_before_change" as const, result: "not_applicable" as const, findings: [] }] : []),
  ];
  // promise_backed is not under test, so a claim it would judge is given a stand-in finding that is never violated.
  if (promised) {
    const claim = detections.find((d) => d.cls === "completion")!;
    results[0] = {
      contract: "promise_backed",
      result: "passed",
      findings: [{ result: "passed", text: "x", said: [claim.seq], did: [], asked: [], gaps: [], fields: [] }],
    };
  }
  const failed = results.some((r) => r.result === "violated");
  const reasons: ReviewReason[] = [];
  for (const r of results.filter((x) => x.result === "unverified")) {
    reasons.push({ kind: "unverified_result", contract: r.contract, text: REASON_LINE.unverified_result, seqs: [] });
  }
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
  evidence: Evidence;
}

/** Runs the contract the way the pipeline will (resolveOk, detections, changes, every committed-detail gap added), then checks the schema. */
function run(input: Evidence, policy: Policy = PRESET, addGaps = true, zone: { tz: string; policyTz: boolean } = { tz: "UTC", policyTz: true }): Run {
  const resolved = resolveOk({ ...input, callStartMs: input.callStartMs ?? CALL_START }, policy);
  const list = changes(resolved, policy);
  const gaps = addGaps ? list.flatMap((c) => committedDetails(resolved, policy, c).gaps) : [];
  const evidence: Evidence = { ...resolved, gaps: [...resolved.gaps, ...gaps] };
  const ctx: ContractContext = {
    ev: evidence,
    policy,
    policySource: "preset",
    tz: zone.tz,
    policyTz: zone.policyTz,
    detections: detectAll(evidence, Object.keys(policy.tools)),
    changes: list,
    providerNames: providerNames(evidence, policy),
  };
  const out = spokenMatchesCommitted(ctx);
  assertValidReport(minimalReport(evidence, policy, ctx.detections, out));
  return { out, finding: out.findings[0], evidence };
}

describe("spoken_matches_committed", () => {
  describe("not applicable", () => {
    it("is not applicable when nothing was changed", () => {
      const r = run(ev([...lookup([slot("s1")]), agent("Would Friday at 2 PM work?", 9)]));
      expect(r.out).toEqual({ contract: "spoken_matches_committed", result: "not_applicable", findings: [] });
    });

    it("ignores a change that failed: only a successful change is compared", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1", { ok: false, error: "taken" }), agent(FRIDAY_2PM, 20)]));
      expect(r.out.result).toBe("not_applicable");
      expect(r.out.findings).toEqual([]);
    });

    it("ignores a change whose success is unknown", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1", { error: "slot taken" }), agent(FRIDAY_2PM, 20)]));
      expect(r.evidence.items.find((it) => it.kind === "tool_result" && it.id === "tc_1")).toMatchObject({ ok: null });
      expect(r.out.result).toBe("not_applicable");
    });

    it("a change that committed nothing to compare, such as a cancellation, is not applicable", () => {
      const r = run(ev([...tool("tc_1", "cancel_appointment", { appointmentId: "a1" }, { ok: true }), agent("Your appointment is cancelled.", 20)]));
      expect(r.out).toEqual({ contract: "spoken_matches_committed", result: "not_applicable", findings: [] });
    });
  });

  describe("passed", () => {
    it("passes when every field the agent said matches and the required ones were all said", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent(FRIDAY_2PM, 20)]));
      expect(r.out.result).toBe("passed");
      expect(r.out.findings).toEqual([
        {
          result: "passed",
          text: PASSED_TEXT,
          said: [5],
          did: [2, 3, 4],
          asked: [],
          gaps: [],
          fields: [
            { field: "date", type: "date", from: "spoken", values: ["Friday, November 6"], committed: "Friday, November 6", status: "match" },
            { field: "time", type: "time", from: "spoken", values: ["2 PM"], committed: "2:00 PM", status: "match" },
            { field: "provider", type: "name", from: "spoken", values: ["Dr. Nair"], committed: NAIR, status: "match" },
          ],
        },
      ]);
    });

    it("an optional field the agent did not say is shown as not spoken and still passes", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 at 2 PM.", 20)]));
      expect(r.out.result).toBe("passed");
      expect(r.finding.text).toBe("The agent confirmed Friday, November 6 at 2:00 PM. That is what was committed.");
      expect(r.finding.fields.map((f) => [f.field, f.status])).toEqual([
        ["date", "match"],
        ["time", "match"],
        ["provider", "not_spoken"],
      ]);
    });

    it("an optional field whose committed value is hidden by privacy is left out when the agent named no provider", () => {
      const r = run(ev([...lookup([slot("s1", undefined, "[person name 1]")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 at 2 PM.", 20)]));
      expect(r.out.result).toBe("passed");
      expect(r.finding.gaps).toEqual([]);
      expect(r.finding.fields.map((f) => f.field)).toEqual(["date", "time"]);
      expect(r.finding.text).not.toContain("person name");
    });

    it("compares only the claim: an earlier turn that said something else does not matter", () => {
      const r = run(ev([agent("Should I book Thursday at 9 AM with Dr. Okafor?", 3), ...lookup([slot("s1")]), ...book("tc_1", "s1"), agent(FRIDAY_2PM, 20)]));
      expect(r.out.result).toBe("passed");
    });

    it("a clear sentence in the same turn as a vague one is read together", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're all set. I booked Friday, November 6 at 2 PM with Dr. Nair.", 20)]));
      expect(r.out.result).toBe("passed");
      expect(r.finding.text).toBe(PASSED_TEXT);
    });
  });

  describe("violated", () => {
    it("is violated when a field both spoken and committed differs, and names both", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 at 3 PM with Dr. Nair.", 20)]));
      expect(r.out.result).toBe("violated");
      expect(r.out.findings).toEqual([
        {
          result: "violated",
          text: "The agent confirmed Friday, November 6 at 3 PM with Dr. Priya Nair. What was committed is Friday, November 6 at 2:00 PM with Dr. Priya Nair.",
          said: [5],
          did: [2, 3, 4],
          asked: [],
          gaps: [],
          fields: [
            { field: "date", type: "date", from: "spoken", values: ["Friday, November 6"], committed: "Friday, November 6", status: "match" },
            { field: "time", type: "time", from: "spoken", values: ["3 PM"], committed: "2:00 PM", status: "differs" },
            { field: "provider", type: "name", from: "spoken", values: ["Dr. Nair"], committed: NAIR, status: "match" },
          ],
        },
      ]);
    });

    it("is violated for a different provider the call knows, and still lists the unchecked field", () => {
      const slots = [slot("s1"), slot("s2", "2026-11-06T15:00:00.000Z", "Dr. James Okafor")];
      const r = run(ev([...lookup(slots), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 with Dr. Okafor.", 20)]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.fields.find((f) => f.field === "provider")?.status).toBe("differs");
      expect(r.finding.fields.find((f) => f.field === "time")?.status).toBe("not_spoken");
    });

    it("one field that differs makes it violated even when another required field was not said", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're booked for Saturday, November 7.", 20)]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.text).toBe("The agent confirmed Saturday, November 7. What was committed is Friday, November 6.");
    });
  });

  describe("unverified", () => {
    it("no claim after a successful change is unverified with the no_claim reason", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("Is there anything else?", 20)]));
      expect(r.out.result).toBe("unverified");
      expect(r.out.findings).toEqual([
        {
          result: "unverified",
          text: "Couldn't check spoken details match the booking: the agent never confirmed the booking.",
          said: [],
          did: [2, 3, 4],
          asked: [],
          gaps: [],
          fields: [],
        },
      ]);
    });

    it("a required field resolved but not spoken is unverified and the finding lists checked and unchecked fields", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 with Dr. Nair.", 20)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toBe("Couldn't check spoken details match the booking: the agent didn't say the time.");
      expect(r.finding.said).toEqual([5]);
      expect(r.finding.gaps).toEqual([]);
      expect(r.finding.fields).toEqual([
        { field: "date", type: "date", from: "spoken", values: ["Friday, November 6"], committed: "Friday, November 6", status: "match" },
        { field: "time", type: "time", from: "spoken", values: [], committed: "2:00 PM", status: "not_spoken" },
        { field: "provider", type: "name", from: "spoken", values: ["Dr. Nair"], committed: NAIR, status: "match" },
      ]);
    });

    it("a claim that names no field at all says what was not said", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("Your appointment is booked.", 20)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toBe("Couldn't check spoken details match the booking: the agent didn't say the date; the agent didn't say the time.");
    });

    it("a required field that couldn't be resolved is unverified, whatever was said", () => {
      const r = run(ev([...lookup([slot("other")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 at 3 PM.", 20)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toBe("Couldn't check spoken details match the booking: the date of the booking isn't in the call; the time of the booking isn't in the call.");
      expect(r.finding.gaps).toEqual(["unresolved_committed_detail"]);
      expect(r.finding.fields.map((f) => [f.field, f.committed, f.status])).toEqual([
        ["date", null, "unresolved"],
        ["time", null, "unresolved"],
      ]);
    });

    it("a scrubbed placeholder is unresolved, so the finding is unverified, not violated", () => {
      const r = run(ev([...lookup([slot("s1", "[date 1]")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 at 3 PM with Dr. Nair.", 20)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual(["unresolved_committed_detail"]);
      expect(r.finding.text).not.toContain("[date 1]");
      for (const row of r.finding.fields) {
        expect(row.committed === null || !row.committed.includes("[")).toBe(true);
      }
    });

    it("a scrubbed optional provider the agent named is unverified, with its row unresolved", () => {
      const r = run(ev([...lookup([slot("s1", undefined, "[person name 1]")]), ...book("tc_1", "s1"), agent(FRIDAY_2PM, 20)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toBe("Couldn't check spoken details match the booking: the provider of the booking isn't in the call.");
      expect(r.finding.text).not.toContain("person name");
      expect(r.finding.gaps).toEqual(["unresolved_committed_detail"]);
      expect(r.finding.fields.find((f) => f.field === "provider")).toEqual({
        field: "provider",
        type: "name",
        from: "spoken",
        values: ["Dr. Nair"],
        committed: null,
        status: "unresolved",
      });
    });

    it("a field with no committed value never matches", () => {
      const withNone: Slot = { id: "s1", startsAt: "2026-11-06T14:00:00.000Z" };
      const r = run(ev([...lookup([withNone]), ...book("tc_1", "s1"), agent(FRIDAY_2PM, 20)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.fields.find((f) => f.field === "provider")).toMatchObject({ committed: null, status: "unresolved" });
      for (const out of [r.out, run(ev([...lookup([slot("other")]), ...book("tc_1", "s1"), agent(FRIDAY_2PM, 20)])).out]) {
        for (const f of out.findings.flatMap((x) => x.fields)) {
          if (f.committed === null) expect(f.status).not.toBe("match");
        }
      }
    });

    it("a committed value that is an object is never shown as JSON, and never compared", () => {
      const r = run(ev([...lookup([slot("s1", undefined, { first: "Priya", last: "Nair" })]), ...book("tc_1", "s1"), agent(FRIDAY_2PM, 20)]));
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).not.toMatch(/[{}"]/);
      expect(r.finding.fields.find((f) => f.field === "provider")).toMatchObject({ committed: null, status: "unresolved" });
    });

    it("lookups that disagree leave the field unresolved, so a differing claim is unverified", () => {
      const e = ev([
        ...lookup([slot("s1", "2026-11-06T14:00:00.000Z")], "tc_a"),
        ...lookup([slot("s1", "2026-11-06T16:00:00.000Z")], "tc_b"),
        ...book("tc_1", "s1"),
        agent("You're booked for Friday, November 6 at 3 PM with Dr. Nair.", 30),
      ]);
      const r = run(e);
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual(["unresolved_committed_detail"]);
      expect(r.finding.did).toEqual([2, 4, 5, 6]);
    });

    it("a gap that touches the change keeps a differing claim from being violated", () => {
      const e = ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 at 3 PM with Dr. Nair.", 20)], {
        gaps: [{ code: "evidence_conflict", detail: "The backend log and the record disagree.", seqs: [4], tool: "book_appointment" }],
      });
      const r = run(e);
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual(["evidence_conflict"]);
      expect(r.finding.text).toBe("Couldn't check spoken details match the booking: the backend log and the call record disagree about book_appointment.");
    });

    it("with ordering none it is unverified, never violated", () => {
      const e = ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 at 3 PM with Dr. Nair.", 20)], { ordering: "none" });
      const r = run(e);
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toBe("Couldn't check spoken details match the booking: the call record doesn't say what happened first.");
    });
  });

  describe("conflicting sentences in one turn (differs wins)", () => {
    const wrongThenRight = "You're booked for Friday, November 6 at 3 PM. You're all set for Friday, November 6 at 2 PM.";

    it("a right sentence followed by a wrong one is violated", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 at 2 PM. Your appointment is confirmed for Friday, November 6 at 3 PM.", 20)]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.fields.find((f) => f.field === "time")).toMatchObject({ status: "differs", values: ["2 PM", "3 PM"] });
      expect(r.finding.text).toBe("The agent confirmed Friday, November 6 at 3 PM. What was committed is Friday, November 6 at 2:00 PM.");
    });

    it("a wrong sentence followed by a right one is violated", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent(wrongThenRight, 20)]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.fields.find((f) => f.field === "time")?.status).toBe("differs");
    });

    it("a wrong date in a second sentence is violated even when the first sentence's date was right", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 at 2 PM. Your appointment is confirmed for Saturday, November 7.", 20)]));
      expect(r.out.result).toBe("violated");
      expect(r.finding.fields.find((f) => f.field === "date")).toMatchObject({ status: "differs", values: ["Friday, November 6", "Saturday, November 7"] });
      expect(r.finding.fields.find((f) => f.field === "time")?.status).toBe("match");
    });

    it("sentences that say different fields and none wrong are combined into a pass", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6. Your appointment is confirmed for 2 PM with Dr. Nair.", 20)]));
      expect(r.out.result).toBe("passed");
      expect(r.finding.text).toBe(PASSED_TEXT);
    });

    it("a sentence is never glued to the next: a name stops at its own sentence", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("You're booked for Friday, November 6 at 2 PM with Dr. Nair. You're all set.", 20)]));
      expect(r.out.result).toBe("passed");
      expect(r.finding.fields.find((f) => f.field === "provider")?.values).toEqual(["Dr. Nair"]);
    });

    it("a claim of another kind in the turn is not about this change", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent("Your old appointment is cancelled for Monday, November 9 at 9 AM. You're booked for Friday, November 6 at 2 PM with Dr. Nair.", 20)]));
      expect(r.out.result).toBe("passed");
    });
  });

  describe("fields without a definition, and changes with nothing to compare", () => {
    const withRoom: Policy = PolicySchema.parse({
      ...preset,
      tools: { ...preset.tools, book_appointment: { ...preset.tools.book_appointment, required: ["date", "time", "room"] } },
    });

    it("a required field the policy has no definition for is unresolved, so the finding is unverified", () => {
      const r = run(ev([...lookup([slot("s1")]), ...book("tc_1", "s1"), agent(FRIDAY_2PM, 20)]), withRoom);
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toBe("Couldn't check spoken details match the booking: the room of the booking isn't in the call.");
      expect(r.finding.gaps).toEqual(["unresolved_committed_detail"]);
      expect(r.finding.fields.at(-1)).toEqual({ field: "room", type: "string", from: "spoken", values: [], committed: null, status: "unresolved" });
    });

    it("a successful cancellation nobody confirmed is unverified with the no_claim reason", () => {
      const r = run(ev([...tool("tc_1", "cancel_appointment", { appointmentId: "a1" }, { ok: true }), agent("Anything else today?", 20)]));
      expect(r.out.result).toBe("unverified");
      expect(r.out.findings).toEqual([
        {
          result: "unverified",
          text: "Couldn't check spoken details match the booking: the agent never confirmed the cancellation.",
          said: [],
          did: [1, 2],
          asked: [],
          gaps: [],
          fields: [],
        },
      ]);
    });

    it("a cancellation followed by a booking that is confirmed once is judged on the booking alone", () => {
      const r = run(ev([...lookup([slot("s1")]), ...tool("tc_c", "cancel_appointment", { appointmentId: "a1" }, { ok: true }), ...book("tc_1", "s1"), agent(FRIDAY_2PM, 20)]));
      expect(r.out.findings.map((f) => f.result)).toEqual(["passed"]);
    });
  });

  describe("unresolved gaps in the evidence", () => {
    it("a finding never cites a gap code the evidence does not hold", () => {
      const r = run(ev([...lookup([slot("other")]), ...book("tc_1", "s1"), agent(FRIDAY_2PM, 20)]), PRESET, false);
      expect(r.out.result).toBe("unverified");
      expect(r.finding.gaps).toEqual([]);
    });
  });

  describe("several changes", () => {
    it("pairs each change with its own first completion claim", () => {
      const slots = [slot("s1"), slot("s2", "2026-11-06T16:00:00.000Z")];
      const r = run(
        ev([
          ...lookup(slots),
          ...book("tc_1", "s1"),
          agent("You're booked for Friday, November 6 at 2 PM with Dr. Nair.", 20),
          ...book("tc_2", "s2"),
          agent("You're booked for Friday, November 6 at 4 PM with Dr. Nair.", 40),
          agent("Your appointment is confirmed for Friday, November 6 at 9 AM.", 45),
        ]),
      );
      expect(r.out.findings.map((f) => [f.result, f.said, f.did])).toEqual([
        ["passed", [5], [2, 3, 4]],
        ["passed", [8], [2, 6, 7]],
      ]);
      expect(r.out.result).toBe("passed");
      expect(r.out.findings[1].text).toBe("The agent confirmed Friday, November 6 at 4:00 PM with Dr. Priya Nair. That is what was committed.");
    });

    it("the first booking's claim is not the second booking's: a change with no claim before the next change is unverified", () => {
      const slots = [slot("s1"), slot("s2", "2026-11-06T16:00:00.000Z")];
      const r = run(
        ev([
          ...lookup(slots),
          ...book("tc_1", "s1"),
          ...book("tc_2", "s2"),
          agent("You're booked for Friday, November 6 at 4 PM with Dr. Nair.", 40),
        ]),
      );
      expect(r.out.findings.map((f) => f.result)).toEqual(["unverified", "passed"]);
      expect(r.out.findings[0].text).toBe("Couldn't check spoken details match the booking: the agent never confirmed the booking.");
      expect(r.out.result).toBe("unverified");
    });

    it("the result is the worst of the findings", () => {
      const slots = [slot("s1"), slot("s2", "2026-11-06T16:00:00.000Z")];
      const r = run(
        ev([
          ...lookup(slots),
          ...book("tc_1", "s1"),
          agent("You're booked for Friday, November 6 at 3 PM with Dr. Nair.", 20),
          ...book("tc_2", "s2"),
          agent("Is there anything else?", 40),
        ]),
      );
      expect(r.out.findings.map((f) => f.result)).toEqual(["violated", "unverified"]);
      expect(r.out.result).toBe("violated");
    });

    it("a recovered retry is compared with the successful change", () => {
      const slots = [slot("s1"), slot("s2", "2026-11-06T16:00:00.000Z")];
      const r = run(
        ev([
          ...lookup(slots),
          ...book("tc_1", "s1", { ok: false, error: "That slot was just taken." }),
          ...book("tc_2", "s2"),
          agent("You're booked for Friday, November 6 at 4 PM with Dr. Nair.", 40),
        ]),
      );
      expect(r.out.result).toBe("passed");
      expect(r.out.findings).toHaveLength(1);
      expect(r.finding.did).toEqual([2, 5, 6]);
      expect(r.finding.text).toBe("The agent confirmed Friday, November 6 at 4:00 PM with Dr. Priya Nair. That is what was committed.");
    });

    it("a failed try after a success does not move the success's claim window", () => {
      const slots = [slot("s1"), slot("s2", "2026-11-06T16:00:00.000Z")];
      const r = run(
        ev([
          ...lookup(slots),
          ...book("tc_1", "s1"),
          ...book("tc_2", "s2", { ok: false, error: "taken" }),
          agent("You're booked for Friday, November 6 at 2 PM with Dr. Nair.", 40),
        ]),
      );
      expect(r.out.findings).toHaveLength(1);
      expect(r.out.result).toBe("passed");
      expect(r.finding.did).toEqual([2, 3, 4]);
    });
  });

  // OVE-49: an inferred policy has no zone, so the machine's zone is only one plausible reading of a committed time.
  // A spoken value that fits another plausible zone (UTC, or the slot's own offset) and not the machine's is
  // unverified, never violated. A spoken value that fits no plausible zone still differs.
  describe("an inferred policy's zone", () => {
    const INFERRED: Policy = PolicySchema.parse({ ...PRESET, timezone: undefined });
    const inferredIn = (tz: string, startsAt: string, said: string) =>
      run(ev([...lookup([slot("s1", startsAt)]), ...book("tc_1", "s1"), agent(said, 20)]), INFERRED, true, { tz, policyTz: false });
    const NY = "America/New_York";

    it("a time that fits UTC but not the machine's zone is unverified with the zone named, not violated", () => {
      const r = inferredIn(NY, "2026-11-13T19:00:00Z", "You're booked for Friday, November 13 at 7 PM with Dr. Nair.");
      expect(r.out.result).toBe("unverified");
      expect(r.finding.result).toBe("unverified");
      expect(r.finding.text).toBe(
        "Couldn't check spoken details match the booking: the agent said Friday, November 13 at 7 PM, and the booking is Friday, November 13 at 7:00 PM UTC, which is Friday, November 13 at 2:00 PM where this check ran, so we couldn't tell which date and time the caller meant.",
      );
      expect(r.finding.fields.map((f) => [f.field, f.status])).toEqual([
        ["date", "match"],
        ["time", "unresolved"],
        ["provider", "match"],
      ]);
      // The row names both readings, so a reader sees why it is unclear.
      expect(r.finding.fields[1]).toMatchObject({ values: ["7 PM"], committed: "2:00 PM here or 7:00 PM UTC" });
      expect(r.finding.gaps).toEqual([]);
    });

    it("the same slot read as the machine's zone says it matches", () => {
      const r = inferredIn(NY, "2026-11-13T19:00:00Z", "You're booked for Friday, November 13 at 2 PM with Dr. Nair.");
      expect(r.out.result).toBe("passed");
    });

    it("a time that fits no plausible zone still differs", () => {
      const r = inferredIn(NY, "2026-11-13T19:00:00Z", "You're booked for Friday, November 13 at 4 PM with Dr. Nair.");
      expect(r.out.result).toBe("violated");
      expect(r.finding.fields.find((f) => f.field === "time")?.status).toBe("differs");
    });

    it("a date that crosses midnight matches in the machine's zone", () => {
      const r = inferredIn(NY, "2026-11-14T01:00:00Z", "You're booked for Friday, November 13 at 8 PM with Dr. Nair.");
      expect(r.out.result).toBe("passed");
    });

    it("a time that fits only UTC is unverified when the machine is far east", () => {
      const r = inferredIn("Asia/Tokyo", "2026-11-13T14:00:00Z", "You're booked for Friday, November 13 at 2 PM with Dr. Nair.");
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toContain("which is Friday, November 13 at 11:00 PM where this check ran");
      expect(r.finding.fields.find((f) => f.field === "time")?.status).toBe("unresolved");
      expect(r.finding.fields.find((f) => f.field === "date")?.status).toBe("match");
    });

    it("a date and time that fit only the UTC reading are one doubt, said once", () => {
      const r = inferredIn(NY, "2026-11-14T01:00:00Z", "You're booked for Saturday, November 14 at 1 AM with Dr. Nair.");
      expect(r.out.result).toBe("unverified");
      expect(r.finding.fields.map((f) => [f.field, f.status])).toEqual([
        ["date", "unresolved"],
        ["time", "unresolved"],
        ["provider", "match"],
      ]);
      expect(r.finding.fields[0].committed).toBe("Friday, November 13 here or Saturday, November 14 UTC");
      expect(r.finding.text).toBe(
        "Couldn't check spoken details match the booking: the agent said Saturday, November 14 at 1 AM, and the booking is Saturday, November 14 at 1:00 AM UTC, which is Friday, November 13 at 8:00 PM where this check ran, so we couldn't tell which date and time the caller meant.",
      );
    });

    // One reading per claim: a date from one zone and a time from another is never accepted.
    it("a date from the machine's zone with a time from UTC is violated", () => {
      const r = inferredIn(NY, "2026-11-14T01:00:00Z", "You're booked for Friday, November 13 at 1 AM with Dr. Nair.");
      expect(r.out.result).toBe("violated");
    });

    it("a date from UTC with a time from the machine's zone is violated", () => {
      const r = inferredIn(NY, "2026-11-14T01:00:00Z", "You're booked for Saturday, November 14 at 8 PM with Dr. Nair.");
      expect(r.out.result).toBe("violated");
    });

    it("a weekday with a time from the other zone is violated", () => {
      const wed = Date.parse("2026-11-11T15:00:00Z");
      const input = ev([...lookup([slot("s1", "2026-11-14T01:00:00Z")]), ...book("tc_1", "s1"), agent("You're booked for Friday at 1 AM with Dr. Nair.", 20)]);
      const r = run({ ...input, callStartMs: wed }, INFERRED, true, { tz: NY, policyTz: false });
      expect(r.out.result).toBe("violated");
    });

    it("two sentences, each right in a different zone, are violated: no zone makes both true", () => {
      const r = inferredIn(
        NY,
        "2026-11-13T19:00:00Z",
        "You're booked for Friday, November 13 at 7 PM. Your appointment is confirmed for Friday, November 13 at 2 PM with Dr. Nair.",
      );
      expect(r.out.result).toBe("violated");
    });

    // "Today" and "tomorrow" are counted in the day of the zone each reading uses.
    it("tomorrow, counted in UTC, fits and is unverified, not violated", () => {
      const late = Date.parse("2026-11-13T02:00:00Z"); // Nov 12, 9 PM in New York
      const input = ev([...lookup([slot("s1", "2026-11-14T10:00:00Z")]), ...book("tc_1", "s1"), agent("You're booked for tomorrow at 10 AM with Dr. Nair.", 20)]);
      const r = run({ ...input, callStartMs: late }, INFERRED, true, { tz: NY, policyTz: false });
      expect(r.out.result).toBe("unverified");
    });

    it("today, counted in UTC, fits and is unverified, not violated", () => {
      const late = Date.parse("2026-11-13T02:00:00Z");
      const input = ev([...lookup([slot("s1", "2026-11-13T19:00:00Z")]), ...book("tc_1", "s1"), agent("You're booked for today at 7 PM with Dr. Nair.", 20)]);
      const r = run({ ...input, callStartMs: late }, INFERRED, true, { tz: NY, policyTz: false });
      expect(r.out.result).toBe("unverified");
    });

    it("a slot with its own offset: the time as written is the match, in any machine zone", () => {
      const r = inferredIn("Europe/London", "2026-11-13T14:00:00-05:00", "You're booked for Friday, November 13 at 2 PM with Dr. Nair.");
      expect(r.out.result).not.toBe("violated");
    });

    it("a slot with its own offset: the time in the machine's zone is unverified, never violated", () => {
      const r = inferredIn("Europe/London", "2026-11-13T14:00:00-05:00", "You're booked for Friday, November 13 at 7 PM with Dr. Nair.");
      expect(r.out.result).toBe("unverified");
      expect(r.finding.text).toContain("the booking is Friday, November 13 at 7:00 PM where this check ran, which is Friday, November 13 at 2:00 PM at the booking's own offset");
    });

    it("a slot with its own offset and a time that fits neither still differs", () => {
      const r = inferredIn("Europe/London", "2026-11-13T14:00:00-05:00", "You're booked for Friday, November 13 at 4 PM with Dr. Nair.");
      expect(r.out.result).toBe("violated");
    });

    it("a mismatch in another sentence of the claim still wins over a zone doubt", () => {
      const r = inferredIn(NY, "2026-11-13T19:00:00Z", "You're booked for Friday, November 13 at 7 PM. Your appointment is confirmed for Friday, November 13 at 4 PM.");
      expect(r.out.result).toBe("violated");
    });

    it("a preset zone is never second-guessed: UTC wall time that is not the zone's still differs", () => {
      const said = (t: string) => ev([...lookup([slot("s1", "2026-11-13T19:00:00Z")]), ...book("tc_1", "s1"), agent(`You're booked for Friday, November 13 at ${t} with Dr. Nair.`, 20)]);
      expect(run(said("2 PM"), PRESET, true, { tz: NY, policyTz: true }).out.result).toBe("passed");
      expect(run(said("7 PM"), PRESET, true, { tz: NY, policyTz: true }).out.result).toBe("violated");
    });
  });

  describe("the sample calls", () => {
    const samples: [string, CallReport][] = [
      ["passed", passedSample],
      ["failed", failedSample],
      ["needs-review", needsReviewSample],
    ];
    for (const [name, sample] of samples) {
      it(`reproduces the ${name} sample's spoken_matches_committed result`, () => {
        const policy = sample.policy;
        const resolved = resolveOk(sample.evidence, policy);
        const list = changes(resolved, policy);
        expect(successfulChanges(list).length > 0 || name === "needs-review").toBe(true);
        const evidence: Evidence = { ...resolved, gaps: [...resolved.gaps, ...list.flatMap((c) => committedDetails(resolved, policy, c).gaps)] };
        const out = spokenMatchesCommitted({
          ev: evidence,
          policy,
          policySource: "preset",
          tz: sample.timezone,
          policyTz: policy.timezone !== undefined,
          detections: detectAll(evidence, Object.keys(policy.tools)),
          changes: list,
          providerNames: providerNames(evidence, policy),
        });
        expect(out).toEqual(sample.results.find((r) => r.contract === "spoken_matches_committed"));
      });
    }
  });
});
