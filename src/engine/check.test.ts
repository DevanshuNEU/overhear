// @vitest-environment node
// checkCall: every check on one call, in order, into one report. The goldens against the three samples live in
// golden.test.ts; this file covers the pipeline's own rules (what is added to the evidence, which contracts run,
// the time zone, the policy source) on hand-built calls, and that every report it makes validates.
import { describe, expect, it } from "vitest";
import { CONTRACT_IDS, CallReportSchema, PolicySchema, type CallReport, type Evidence, type Policy } from "@/report/schema";
import * as variants from "@/report/samples/variants.fixture";
import { SAMPLE_REPORTS } from "@/report/samples";
import { checkCall } from "./check";
import { policyFor } from "./policy";
import preset from "./presets/northwind-clinic.json";
import { ev, type ItemSpec } from "./testing/build";

const PRESET: Policy = PolicySchema.parse(preset);

const agent = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "agent", text, startSec, interrupted: null });
const caller = (text: string, startSec: number | null = null): ItemSpec => ({ kind: "turn", role: "caller", text, startSec, interrupted: null });
const call = (id: string, name: string, args: Record<string, unknown> = {}): ItemSpec => ({ kind: "tool_call", id, name, args });
const result = (id: string, payload: unknown, platformOk: boolean | null = true): ItemSpec => ({ kind: "tool_result", id, ok: null, platformOk, payload });
const tool = (id: string, name: string, args: Record<string, unknown>, payload: unknown): ItemSpec[] => [call(id, name, args), result(id, payload)];

const slot = (startsAt: string, providerName = "Dr. Priya Nair") => ({ id: "slot_1", providerName, startsAt });

/** A lookup, a booking of its slot, and the agent's confirmation. */
function booked(startsAt: string, confirmation: string, providerName = "Dr. Priya Nair"): Evidence {
  return ev([
    caller("Book me for Friday.", 1),
    ...tool("tc_1", "check_availability", { date: "2026-11-06" }, { slots: [slot(startsAt, providerName)] }),
    agent("Booking that now.", 10),
    ...tool("tc_2", "book_appointment", { slotId: "slot_1", patientId: "p1" }, { ok: true }),
    agent(confirmation, 20),
  ]);
}

function parsed(report: CallReport): CallReport {
  return CallReportSchema.parse(report);
}

describe("checkCall", () => {
  it("runs the scheduling pack: three contracts in spec order, then committed_matches_request as not_run", () => {
    const r = parsed(checkCall(booked("2026-11-06T14:00:00Z", "You're booked for Friday, November 6 at 2:00 p.m. with Dr. Priya Nair."), PRESET, { tz: "UTC", policySource: "preset" }));
    expect(r.results.map((c) => c.contract)).toEqual(["promise_backed", "spoken_matches_committed", "transfer_kept", "committed_matches_request"]);
    expect(r.results.at(-1)).toEqual({ contract: "committed_matches_request", result: "not_run", findings: [] });
    expect(r.request).toBeNull();
    expect(r.requestSource).toBeNull();
    expect(r.llmUsed).toBe(false);
    expect(r.verdict).toBe("passed");
    expect(r.notes).toEqual(["request_not_checked"]);
  });

  it("lists only the scheduling pack whatever the policy it was given says", () => {
    const healthcare: Policy = { ...PRESET, packs: ["healthcare"] };
    const r = parsed(checkCall(booked("2026-11-06T14:00:00Z", "You're booked for Friday at 2:00 p.m."), healthcare, { tz: "UTC", policySource: "preset" }));
    expect(r.policy.packs).toEqual(["scheduling"]);
    expect(r.results.map((c) => c.contract)).not.toContain("verified_before_change");
    expect(healthcare.packs).toEqual(["healthcare"]);
    expect(CONTRACT_IDS).toContain("verified_before_change");
  });

  it("reports the call's id and platform, the policy it was given and the evidence it judged", () => {
    const e = booked("2026-11-06T14:00:00Z", "You're booked for Friday at 2:00 p.m.");
    const r = checkCall(e, PRESET, { tz: "UTC", policySource: "preset" });
    expect(r.callId).toBe(e.callId);
    expect(r.platform).toBe("retell");
    expect(r.policy).toEqual({ ...PRESET, packs: ["scheduling"] });
    expect(r.evidence.items.filter((i) => i.kind === "tool_result").map((i) => (i as { ok: boolean | null }).ok)).toEqual([true, true]);
  });

  it("does not change the evidence or the policy it was given", () => {
    const e = booked("2026-11-06T14:00:00Z", "You're booked for Friday at 2:00 p.m.");
    const before = structuredClone(e);
    const policyBefore = structuredClone(PRESET);
    checkCall(e, PRESET, { tz: "UTC", policySource: "preset" });
    expect(e).toEqual(before);
    expect(PRESET).toEqual(policyBefore);
  });

  it("is the same on every run", () => {
    const e = booked("2026-11-06T14:00:00Z", "You're booked for Friday at 2:00 p.m.");
    expect(checkCall(e, PRESET, { tz: "UTC", policySource: "preset" })).toEqual(checkCall(e, PRESET, { tz: "UTC", policySource: "preset" }));
  });

  describe("time zone", () => {
    const noZone: Policy = (() => {
      const p: Policy = structuredClone(PRESET);
      delete p.timezone;
      return p;
    })();

    it("reads spoken times in the policy's zone when it names one, whatever the caller's zone", () => {
      const r = parsed(checkCall(booked("2026-11-06T14:00:00Z", "You're booked for Friday, November 6 at 2:00 p.m."), PRESET, { tz: "America/New_York", policySource: "preset" }));
      expect(r.timezone).toBe("UTC");
      expect(r.results.find((c) => c.contract === "spoken_matches_committed")?.result).toBe("passed");
    });

    it("reads them in the caller's zone when the policy names none", () => {
      const said = "You're booked for Friday, November 6 at 2:00 p.m.";
      const ny = parsed(checkCall(booked("2026-11-06T19:00:00Z", said), noZone, { tz: "America/New_York", policySource: "preset" }));
      expect(ny.timezone).toBe("America/New_York");
      expect(ny.results.find((c) => c.contract === "spoken_matches_committed")?.result).toBe("passed");
      const utc = parsed(checkCall(booked("2026-11-06T19:00:00Z", said), noZone, { tz: "UTC", policySource: "preset" }));
      expect(utc.timezone).toBe("UTC");
      expect(utc.results.find((c) => c.contract === "spoken_matches_committed")?.result).toBe("violated");
    });
  });

  describe("the policy source", () => {
    const e = () => ev([caller("Hi.", 1), ...tool("tc_1", "check_availability", {}, { slots: [] }), agent("I'm transferring you to a nurse now.", 10)]);

    it("a preset policy can show that a transfer was never attempted", () => {
      const r = parsed(checkCall(e(), PRESET, { tz: "UTC", policySource: "preset" }));
      expect(r.results.find((c) => c.contract === "transfer_kept")?.result).toBe("violated");
      expect(r.verdict).toBe("failed");
    });

    it("an inferred policy cannot, so the same call is unverified", () => {
      const r = parsed(checkCall(e(), PRESET, { tz: "UTC", policySource: "inferred" }));
      expect(r.results.find((c) => c.contract === "transfer_kept")?.result).toBe("unverified");
      expect(r.verdict).toBe("needs_review");
    });
  });

  it("ignores a kindless claim with no change", () => {
    const e = ev([
      caller("It's Jordan Ellis, born March 14th 1985.", 1),
      ...tool("tc_1", "verify_patient", { name: "Jordan Ellis" }, { verified: true, patientId: "p1" }),
      agent("You're all set.", 10),
    ]);
    const r = parsed(checkCall(e, PRESET, { tz: "UTC", policySource: "preset" }));
    expect(r.verdict).toBe("passed");
    expect(r.results.find((c) => c.contract === "promise_backed")?.result).not.toBe("violated");
  });

  it("a deferral alone sends the call to review with the deferral reason", () => {
    const e = ev([
      caller("I'd like to book.", 1),
      ...tool("tc_1", "check_availability", {}, { error: "calendar offline" }).map((i) => (i.kind === "tool_result" ? { ...i, platformOk: false } : i)),
      agent("I can help once it's back online.", 10),
    ]);
    const r = parsed(checkCall(e, PRESET, { tz: "UTC", policySource: "preset" }));
    expect(r.verdict).toBe("needs_review");
    expect(r.reasons.map((x) => x.kind)).toEqual(["deferral"]);
    expect(r.headline).toBe("The agent deferred the caller's request instead of completing it.");
  });

  describe("gaps", () => {
    const scrubbed = () =>
      ev([
        caller("Book me for Friday.", 1),
        ...tool("tc_1", "check_availability", { date: "2026-11-06" }, { slots: [{ id: "slot_1", providerName: "Dr. Priya Nair", startsAt: "[date 1]" }] }),
        agent("Booking that now.", 10),
        ...tool("tc_2", "book_appointment", { slotId: "slot_1", patientId: "p1" }, { ok: true }),
        agent("You're booked for Friday at 2:00 p.m.", 20),
      ]);

    it("gaps from resolveOk and committedDetails are merged into evidence.gaps, and a finding that cites one validates", () => {
      const r = parsed(checkCall(scrubbed(), PRESET, { tz: "UTC", policySource: "preset" }));
      const codes = r.evidence.gaps.map((g) => g.code);
      expect(codes).toContain("unresolved_committed_detail");
      const spoken = r.results.find((c) => c.contract === "spoken_matches_committed")!;
      expect(spoken.result).toBe("unverified");
      expect(spoken.findings.flatMap((f) => f.gaps)).toContain("unresolved_committed_detail");
      expect(r.verdict).toBe("needs_review");
      expect(r.reasons.map((x) => `${x.kind}:${x.contract}`)).toEqual(["unverified_result:spoken_matches_committed"]);
    });

    // No finding can cite a failed change's details (spoken_matches_committed reads only changes that worked), so a
    // gap for them would show a reader something nothing rests on.
    it("a failed booking of an unknown slot adds no unresolved_committed_detail gap", () => {
      const e = ev([
        caller("Book me for Friday.", 1),
        ...tool("tc_1", "check_availability", { date: "2026-11-06" }, { slots: [slot("2026-11-06T14:00:00Z")] }),
        call("tc_2", "book_appointment", { slotId: "no_such_slot", patientId: "p1" }),
        result("tc_2", { error: "slot taken" }, false),
        agent("Sorry, that didn't go through.", 20),
      ]);
      const r = parsed(checkCall(e, PRESET, { tz: "UTC", policySource: "preset" }));
      expect(r.evidence.gaps.filter((g) => g.code === "unresolved_committed_detail")).toEqual([]);
    });

    it("keeps a gap from resolveOk: a result that says nothing about success", () => {
      const e = ev([
        caller("Book me for Friday.", 1),
        ...tool("tc_1", "check_availability", { date: "2026-11-06" }, { slots: [slot("2026-11-06T14:00:00Z")] }),
        call("tc_2", "book_appointment", { slotId: "slot_1", patientId: "p1" }),
        result("tc_2", { appointmentId: "a1" }, null),
        agent("You're booked for Friday at 2:00 p.m.", 20),
      ]);
      const r = parsed(checkCall(e, PRESET, { tz: "UTC", policySource: "preset" }));
      expect(r.evidence.gaps.map((g) => g.code)).toContain("unknown_success");
      expect(r.results.find((c) => c.contract === "promise_backed")?.result).toBe("unverified");
      expect(r.verdict).toBe("needs_review");
    });

    it("a gap the adapter raised stays, and a missing tool transcript a contract raises joins it once", () => {
      const e = ev([caller("Book me.", 1), agent("You're booked for Friday at 2:00 p.m.", 5)], {
        ordering: "none",
        gaps: [{ code: "missing_tool_transcript", detail: "Retell kept the conversation but not its tool calls, so what the system did and when can't be checked.", seqs: [] }],
      });
      const r = parsed(checkCall(e, PRESET, { tz: "UTC", policySource: "inferred" }));
      expect(r.evidence.gaps.filter((g) => g.code === "missing_tool_transcript")).toHaveLength(1);
      expect(r.verdict).toBe("needs_review");
    });
  });

  // OVE-48. A side tool that fails after a good booking must not turn the call Failed.
  describe("a side tool that fails after a good booking", () => {
    const CONFIRM = "You're booked for Friday, November 13 at 2 PM.";
    const lookup = () => tool("tc_1", "check_availability", { date: "2026-11-13" }, { slots: [slot("2026-11-13T14:00:00Z")] });
    const booking = () => tool("tc_2", "book_appointment", { slotId: "slot_1", patientId: "p1" }, { ok: true });
    const judge = (side: string, args: Record<string, unknown>, confirmation: string) => {
      const e = ev([caller("Book me for Friday.", 1), ...lookup(), ...booking(), ...tool("tc_3", side, args, { ok: false, error: "unavailable" }), agent(confirmation, 20)]);
      const { policy, source } = policyFor(e);
      return { report: parsed(checkCall(e, policy, { tz: "UTC", policySource: source })), policy };
    };

    it("book_callback failing leaves the booking passed", () => {
      const { report, policy } = judge("book_callback", { phone: "555-0100" }, CONFIRM);
      expect(policy.tools.book_callback).toBeUndefined();
      expect(report.verdict).not.toBe("failed");
      expect(report.results.find((r) => r.contract === "promise_backed")?.result).toBe("passed");
    });

    it("cancel_reminder failing leaves the booking passed", () => {
      const { report, policy } = judge("cancel_reminder", { reminderId: "r1" }, "You're all set.");
      expect(policy.tools.cancel_reminder).toBeUndefined();
      expect(report.verdict).not.toBe("failed");
      expect(report.results.find((r) => r.contract === "promise_backed")?.result).toBe("passed");
    });

    it("schedule_follow_up_call failing leaves the booking passed", () => {
      const { report, policy } = judge("schedule_follow_up_call", { phone: "555-0100" }, CONFIRM);
      expect(policy.tools.schedule_follow_up_call).toBeUndefined();
      expect(report.verdict).not.toBe("failed");
    });

    it("a follow-up visit booking that fails, then a confirmation, is Failed", () => {
      const e = ev([
        caller("Book me for Friday.", 1),
        ...lookup(),
        ...tool("tc_2", "book_follow_up_appointment", { slotId: "slot_1", patientId: "p1" }, { ok: false, error: "unavailable" }),
        agent(CONFIRM, 20),
      ]);
      const { policy, source } = policyFor(e);
      expect(policy.tools.book_follow_up_appointment).toMatchObject({ role: "change", kind: "book" });
      expect(parsed(checkCall(e, policy, { tz: "UTC", policySource: source })).verdict).toBe("failed");
    });

    it("a failed follow-up slot booking after a good booking, then a confirmation, is Failed", () => {
      const { report, policy } = judge("book_follow_up_slot", { slotId: "slot_2" }, CONFIRM);
      expect(policy.tools.book_follow_up_slot).toMatchObject({ role: "change", kind: "book" });
      expect(report.verdict).toBe("failed");
    });

    it("a real change failing after a good booking still fails the call", () => {
      const { report } = judge("book_slot", { slotId: "slot_2" }, CONFIRM);
      expect(report.verdict).toBe("failed");
    });
  });

  describe("a call where nothing was done", () => {
    const GREETING = "Hello, this is Riley at Northwind Family Clinic. How may I help you today?";
    const short = ev([agent(GREETING, 0), caller("Hello!", 4), caller("Hey, what's up.", 6), agent("Hi, how can I help?", 8)]);
    const OPTS = { tz: "UTC", policySource: "preset" } as const;

    it("reads Nothing done with every contract not_applicable or not_run, and validates", () => {
      const r = parsed(checkCall(short, PRESET, OPTS));
      expect(r.verdict).toBe("nothing_done");
      expect(r.notes).toEqual([]);
      expect(r.reasons).toEqual([]);
      expect(r.headline).toBe("Nothing done. The caller said almost nothing, and the agent took no action.");
      expect(r.results.map((c) => c.result)).toEqual(["not_applicable", "not_applicable", "not_applicable", "not_run"]);
    });

    it("the same call with one lookup is passed", () => {
      const withLookup = ev([agent(GREETING, 0), caller("Hello!", 4), ...tool("tc_1", "check_availability", { date: "2026-11-06" }, { slots: [] })]);
      expect(parsed(checkCall(withLookup, PRESET, OPTS)).verdict).toBe("passed");
    });

    it("a caller who asks a full question is passed with no_promises_made", () => {
      const asked = ev([agent(GREETING, 0), caller("What time do you open on Saturday mornings, and when do you close?", 4), agent("We open at 8 a.m. and close at noon.", 9)]);
      const r = parsed(checkCall(asked, PRESET, OPTS));
      expect(r.verdict).toBe("passed");
      expect(r.notes).toEqual(["no_promises_made", "request_not_checked"]);
    });

    it("the same short call with only the turns recorded is passed with no_promises_made", () => {
      const turnsOnly = ev([agent(GREETING, 0), caller("Hello!", 4), caller("Hey, what's up.", 6), agent("Hi, how can I help?", 8)], { ordering: "none" });
      const r = parsed(checkCall(turnsOnly, PRESET, OPTS));
      expect(r.verdict).toBe("passed");
      expect(r.notes).toEqual(["no_promises_made", "request_not_checked"]);
    });

    it("a short call where the agent defers is needs_review", () => {
      const deferred = ev([agent(GREETING, 0), caller("Hello!", 4), agent("I'm sorry, the calendar is down right now. I can help once it's back online.", 8)]);
      expect(parsed(checkCall(deferred, PRESET, OPTS)).verdict).toBe("needs_review");
    });
  });

  describe("every output validates", () => {
    const evidences: [string, Evidence][] = [
      ...SAMPLE_REPORTS.map((s): [string, Evidence] => [s.callId, s.evidence]),
      ...Object.entries(variants)
        .filter(([, v]) => typeof v === "object" && v !== null && "evidence" in v)
        .map(([name, v]): [string, Evidence] => [name, (v as CallReport).evidence]),
    ];

    for (const [name, evidence] of evidences) {
      for (const source of ["preset", "inferred"] as const) {
        it(`${name} (${source} policy)`, () => {
          expect(() => parsed(checkCall(evidence, PRESET, { tz: "UTC", policySource: source }))).not.toThrow();
        });
      }
    }
  });
});
