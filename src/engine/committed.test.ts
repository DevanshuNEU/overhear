// @vitest-environment node
// Tool calls, changes and committed details (Tier 1): what the agent's tools were asked to do, which of it worked,
// and the date, time and provider each change committed, read through the lookup that offered the slot. Calls here
// are made up with the seed's names, or are the three scrubbed samples.
import { describe, expect, it } from "vitest";
import { PolicySchema, type Evidence, type Policy } from "@/report/schema";
import { SAMPLE_REPORTS } from "@/report/samples";
import { ev, type ItemSpec } from "./testing/build";
import preset from "./presets/northwind-clinic.json";
import { policyFor } from "./policy";
import { resolveOk } from "./resolve-ok";
import { changes, committedDetails, providerNames, successfulChanges, toolCalls } from "./committed";

const PRESET: Policy = PolicySchema.parse(preset);

/** A tool call and its result, for ev(). The result's ok is set directly, as resolveOk would leave it. */
function tool(id: string, name: string, args: Record<string, unknown>, payload: unknown, ok: boolean | null = true): ItemSpec[] {
  return [
    { kind: "tool_call", id, name, args },
    { kind: "tool_result", id, ok, platformOk: true, payload },
  ];
}

const nair = (id: string, startsAt: string) => ({ id, providerId: "p-1", providerName: "Dr. Priya Nair", startsAt, status: "open" });
const osei = (id: string, startsAt: string) => ({ id, providerId: "p-2", providerName: "Dr. Amara Osei", startsAt, status: "open" });
const turn = (text: string): ItemSpec => ({ kind: "turn", role: "agent", text, startSec: null, interrupted: null });

/** Availability, then a booking of s-2 that worked. */
function booked(): Evidence {
  return ev([
    turn("Let me check."),
    ...tool("tc_1", "check_availability", {}, { slots: [nair("s-1", "2026-11-06T09:00:00.000Z"), nair("s-2", "2026-11-06T14:00:00.000Z")] }),
    ...tool("tc_2", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true, appointmentId: "a-1" }),
  ]);
}

describe("toolCalls", () => {
  it("toolCalls for verify returns verifies with their ok", () => {
    const e = ev([
      ...tool("tc_1", "verify_patient", { name: "A" }, { verified: false }, false),
      ...tool("tc_2", "check_availability", {}, { slots: [] }),
      ...tool("tc_3", "verify_patient", { name: "A" }, { verified: true, patientId: "pt-1" }, true),
    ]);
    const verifies = toolCalls(e, PRESET, "verify");
    expect(verifies.map((v) => [v.toolCallId, v.tool, v.callSeq, v.resultSeq, v.ok, v.role])).toEqual([
      ["tc_1", "verify_patient", 1, 2, false, "verify"],
      ["tc_3", "verify_patient", 5, 6, true, "verify"],
    ]);
    expect(verifies[1].result).toEqual({ verified: true, patientId: "pt-1" });
    expect(verifies[0].args).toEqual({ name: "A" });
  });

  it("a call with no result has a null resultSeq, ok and result", () => {
    const e = ev([{ kind: "tool_call", id: "tc_1", name: "book_appointment", args: { slotId: "s-1" } }]);
    const [use] = toolCalls(e, PRESET, "change");
    expect(use).toMatchObject({ callSeq: 1, resultSeq: null, ok: null, result: null, kind: "book" });
  });

  it("ignores tools the policy does not name", () => {
    const e = ev([...tool("tc_1", "play_music", {}, { ok: true })]);
    expect(toolCalls(e, PRESET, "change")).toEqual([]);
  });

  it("pairs a result with the call that has its id, not a later call that reuses the id", () => {
    const e = ev([
      { kind: "tool_call", id: "tc_1", name: "book_appointment", args: { slotId: "s-1" } },
      { kind: "tool_call", id: "tc_1", name: "book_appointment", args: { slotId: "s-2" } },
      { kind: "tool_result", id: "tc_1", ok: true, platformOk: true, payload: { ok: true } },
    ]);
    expect(toolCalls(e, PRESET, "change").map((u) => [u.callSeq, u.resultSeq])).toEqual([
      [1, null],
      [2, 3],
    ]);
  });
});

describe("changes", () => {
  it("lists change tools with their kind, in order", () => {
    const e = ev([
      ...tool("tc_1", "cancel_appointment", { appointmentId: "a-1" }, { ok: true }),
      ...tool("tc_2", "book_appointment", { slotId: "s-1" }, { ok: false, error: "taken" }, false),
    ]);
    expect(changes(e, PRESET).map((c) => [c.tool, c.kind, c.ok])).toEqual([
      ["cancel_appointment", "cancel", true],
      ["book_appointment", "book", false],
    ]);
  });

  it("successfulChanges drops failed and unknown changes", () => {
    const e = ev([
      ...tool("tc_1", "book_appointment", { slotId: "s-1" }, { ok: false }, false),
      ...tool("tc_2", "book_appointment", { slotId: "s-2" }, { weird: 1 }, null),
      ...tool("tc_3", "book_appointment", { slotId: "s-3" }, { ok: true }, true),
    ]);
    expect(successfulChanges(changes(e, PRESET)).map((c) => c.toolCallId)).toEqual(["tc_3"]);
  });
});

describe("committedDetails", () => {
  it("item. fields resolve through the earlier lookup whose item id equals the change's id", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [nair("s-0", "2026-11-06T09:00:00.000Z")] }),
      ...tool("tc_2", "check_availability", {}, { slots: [osei("s-1", "2026-11-06T10:00:00.000Z"), nair("s-2", "2026-11-06T14:00:00.000Z")] }),
      ...tool("tc_3", "check_availability", {}, { slots: [nair("s-9", "2026-11-06T16:00:00.000Z")] }),
      ...tool("tc_4", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true }),
      ...tool("tc_5", "check_availability", {}, { slots: [nair("s-2", "2026-11-07T08:00:00.000Z")] }),
    ]);
    const [change] = changes(e, PRESET);
    const d = committedDetails(e, PRESET, change);
    expect(d.fields).toEqual({
      date: "2026-11-06T14:00:00.000Z",
      time: "2026-11-06T14:00:00.000Z",
      provider: "Dr. Priya Nair",
    });
    expect(d.types).toEqual({ date: "date", time: "time", provider: "name" });
    expect(d.unresolved).toEqual([]);
    expect(d.gaps).toEqual([]);
  });

  it("a lookup that came after the change, or that failed, does not count", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [nair("s-2", "2026-11-06T09:00:00.000Z")] }, false),
      ...tool("tc_2", "book_appointment", { slotId: "s-2" }, { ok: true }),
      ...tool("tc_3", "check_availability", {}, { slots: [nair("s-2", "2026-11-06T14:00:00.000Z")] }),
    ]);
    const d = committedDetails(e, PRESET, changes(e, PRESET)[0]);
    expect(d.fields).toEqual({});
    expect(d.unresolved).toEqual(["date", "time"]);
  });

  it("args. and result. fields come from the change itself", () => {
    const policy: Policy = {
      packs: ["scheduling"],
      tools: { book: { role: "change", kind: "book" } },
      fields: {
        date: { path: "args.date", type: "date", required: true },
        provider: { path: "result.confirmation.doctor", type: "name" },
        fee: { path: "result.fee", type: "money" },
      },
    };
    const e = ev([...tool("tc_1", "book", { date: "2026-11-06" }, { ok: true, confirmation: { doctor: "Dr. Nair" }, fee: 25 })]);
    const d = committedDetails(e, policy, changes(e, policy)[0]);
    expect(d.fields).toEqual({ date: "2026-11-06", provider: "Dr. Nair", fee: 25 });
    expect(d.types).toEqual({ date: "date", provider: "name", fee: "money" });
    expect(d.unresolved).toEqual([]);
  });

  it("a required field with no lookup is unresolved with an unresolved_committed_detail gap", () => {
    const e = ev([...tool("tc_1", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true })]);
    const [change] = changes(e, PRESET);
    const d = committedDetails(e, PRESET, change);
    expect(d.fields).toEqual({});
    expect(d.unresolved).toEqual(["date", "time"]);
    expect(d.gaps).toHaveLength(2);
    expect(d.gaps[0]).toMatchObject({
      code: "unresolved_committed_detail",
      field: "date",
      tool: "book_appointment",
      kind: "book",
      seqs: [1, 2],
    });
    expect(d.gaps[0].detail).toMatch(/date/);
    expect(d.gaps.map((g) => g.field)).toEqual(["date", "time"]);
  });

  it("an optional field with no source is left out, not unresolved", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [{ id: "s-2", startsAt: "2026-11-06T14:00:00.000Z" }] }),
      ...tool("tc_2", "book_appointment", { slotId: "s-2" }, { ok: true }),
    ]);
    const d = committedDetails(e, PRESET, changes(e, PRESET)[0]);
    expect(d.fields).toEqual({ date: "2026-11-06T14:00:00.000Z", time: "2026-11-06T14:00:00.000Z" });
    expect(d.unresolved).toEqual([]);
    expect(d.gaps).toEqual([]);
  });

  it("a tool-level required: [] leaves unresolved empty", () => {
    const e = ev([...tool("tc_1", "cancel_appointment", { appointmentId: "a-1" }, { ok: true })]);
    const d = committedDetails(e, PRESET, changes(e, PRESET)[0]);
    expect(d.unresolved).toEqual([]);
    expect(d.gaps).toEqual([]);
    expect(d.fields).toEqual({});
  });

  it("a tool-level required list names the fields it needs, and no others", () => {
    const policy: Policy = {
      ...PRESET,
      tools: { ...PRESET.tools, book_appointment: { ...PRESET.tools.book_appointment, required: ["provider"] } },
    };
    const e = ev([...tool("tc_1", "book_appointment", { slotId: "s-2" }, { ok: true })]);
    expect(committedDetails(e, policy, changes(e, policy)[0]).unresolved).toEqual(["provider"]);
  });

  it("a placeholder committed value is unresolved", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, {
        slots: [{ id: "s-2", providerName: "[person name 1]", startsAt: "2026-11-06T14:00:00.000Z" }],
      }),
      ...tool("tc_2", "book_appointment", { slotId: "s-2" }, { ok: true }),
    ]);
    const d = committedDetails(e, PRESET, changes(e, PRESET)[0]);
    expect(d.fields).toEqual({ date: "2026-11-06T14:00:00.000Z", time: "2026-11-06T14:00:00.000Z" });
    expect(d.unresolved).toEqual(["provider"]);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0]).toMatchObject({ code: "unresolved_committed_detail", field: "provider" });
    expect(d.gaps[0].detail).not.toContain("[person name 1]");
  });

  it("a scrubbed slot id cannot be matched, so its fields are unresolved", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [{ id: "[id 1]", startsAt: "2026-11-06T14:00:00.000Z" }] }),
      ...tool("tc_2", "book_appointment", { slotId: "[id 1]" }, { ok: true }),
    ]);
    const d = committedDetails(e, PRESET, changes(e, PRESET)[0]);
    expect(d.fields).toEqual({});
    expect(d.unresolved).toEqual(["date", "time"]);
  });

  it("matches ids by value, not by type or letter case", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [{ id: 7, startsAt: "2026-11-06T14:00:00.000Z" }, { id: "AB-1", startsAt: "2026-11-06T15:00:00.000Z" }] }),
      ...tool("tc_2", "book_appointment", { slotId: "7" }, { ok: true }),
      ...tool("tc_3", "book_appointment", { slotId: "ab-1" }, { ok: true }),
    ]);
    const [a, b] = changes(e, PRESET);
    expect(committedDetails(e, PRESET, a).fields.date).toBe("2026-11-06T14:00:00.000Z");
    expect(committedDetails(e, PRESET, b).fields.date).toBe("2026-11-06T15:00:00.000Z");
  });

  it("ids that differ only in case: an exact match wins, case-insensitive is the fallback", () => {
    const slots = [{ id: "recAb", startsAt: "2026-11-06T09:00:00.000Z" }, { id: "recaB", startsAt: "2026-11-06T15:00:00.000Z" }];
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots }),
      ...tool("tc_2", "book_appointment", { slotId: "recaB" }, { ok: true }),
      ...tool("tc_3", "book_appointment", { slotId: "recAb" }, { ok: true }),
      ...tool("tc_4", "book_appointment", { slotId: "RECAB" }, { ok: true }),
    ]);
    const [a, b, c] = changes(e, PRESET);
    expect(committedDetails(e, PRESET, a).fields.date).toBe("2026-11-06T15:00:00.000Z");
    expect(committedDetails(e, PRESET, b).fields.date).toBe("2026-11-06T09:00:00.000Z");
    // No exact match, and both case-insensitive matches are candidates that disagree on the time: it is unresolved.
    // The date is the same in both, so it still resolves.
    const d = committedDetails(e, PRESET, c);
    expect(d.fields).toEqual({ date: "2026-11-06T15:00:00.000Z" });
    expect(d.unresolved).toEqual(["time"]);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0]).toMatchObject({ field: "time", seqs: [2, 7, 8] });
  });

  it("an exact id in an older lookup beats a case-only match in a newer one", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [{ id: "recAb", startsAt: "2026-11-06T09:00:00.000Z" }] }),
      ...tool("tc_2", "check_availability", {}, { slots: [{ id: "recab", startsAt: "2026-11-06T15:00:00.000Z" }] }),
      ...tool("tc_3", "book_appointment", { slotId: "recAb" }, { ok: true }),
    ]);
    const d = committedDetails(e, PRESET, changes(e, PRESET)[0]);
    expect(d.fields.date).toBe("2026-11-06T09:00:00.000Z");
    expect(d.gaps).toEqual([]);
  });

  it("a lookup whose success is unknown does not offer items", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [{ id: "s-1", startsAt: "2026-11-06T09:00:00.000Z" }] }, null),
      ...tool("tc_2", "book_appointment", { slotId: "s-1" }, { ok: true }),
    ]);
    expect(committedDetails(e, PRESET, changes(e, PRESET)[0]).unresolved).toEqual(["date", "time"]);
  });

  it("a malformed policy path is a policy mistake and throws", () => {
    const bad: Policy = { ...PRESET, fields: { date: { path: "nowhere.startsAt", type: "date", required: true } } };
    const e = booked();
    expect(() => committedDetails(e, bad, changes(e, bad)[0])).toThrow(/policy path/);
  });
});

/** The preset plus a second lookup tool that lists appointments, so two lookups can offer the same item id. */
const WITH_APPOINTMENTS: Policy = {
  ...PRESET,
  tools: { ...PRESET.tools, list_appointments: { role: "lookup", items: "result.appointments", id: "item.id" } },
};

describe("committedDetails when earlier lookups disagree", () => {
  it("two lookups with the same id and different needed fields: unresolved, one gap naming both candidates", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [nair("s-2", "2026-11-10T09:00:00.000Z")] }),
      ...tool("tc_2", "list_appointments", {}, { appointments: [osei("s-2", "2026-12-01T16:00:00.000Z")] }),
      ...tool("tc_3", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true }),
    ]);
    const d = committedDetails(e, WITH_APPOINTMENTS, changes(e, WITH_APPOINTMENTS)[0]);
    expect(d.fields).toEqual({});
    expect(d.unresolved).toEqual(["date", "time"]);
    expect(d.gaps).toHaveLength(1);
    const [gap] = d.gaps;
    expect(gap).toMatchObject({ code: "unresolved_committed_detail", tool: "book_appointment", kind: "book", field: "date, time, provider" });
    expect(gap.seqs).toEqual(expect.arrayContaining([2, 4]));
    expect(gap.seqs).toEqual([2, 4, 5, 6]);
    expect(gap.detail).toBe(
      "Earlier lookups gave different details for this slot: check_availability (result 2) said Tuesday, November 10, 9:00 AM with Dr. Priya Nair; list_appointments (result 4) said Tuesday, December 1, 4:00 PM with Dr. Amara Osei.",
    );
  });

  it("two lookups with the same id and the same needed fields resolve, with no gap", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [nair("s-2", "2026-11-10T09:00:00.000Z")] }),
      ...tool("tc_2", "list_appointments", {}, { appointments: [nair("s-2", "2026-11-10T09:00:00.000Z")] }),
      ...tool("tc_3", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true }),
    ]);
    const d = committedDetails(e, WITH_APPOINTMENTS, changes(e, WITH_APPOINTMENTS)[0]);
    expect(d.fields).toEqual({ date: "2026-11-10T09:00:00.000Z", time: "2026-11-10T09:00:00.000Z", provider: "Dr. Priya Nair" });
    expect(d.unresolved).toEqual([]);
    expect(d.gaps).toEqual([]);
  });

  it("two items with the same id in one lookup that disagree: unresolved", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [nair("s-2", "2026-11-10T09:00:00.000Z"), nair("s-2", "2026-11-11T11:00:00.000Z")] }),
      ...tool("tc_2", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true }),
    ]);
    const d = committedDetails(e, PRESET, changes(e, PRESET)[0]);
    // Both items name the same provider, so that field still resolves.
    expect(d.fields).toEqual({ provider: "Dr. Priya Nair" });
    expect(d.unresolved).toEqual(["date", "time"]);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0].seqs).toEqual([2, 3, 4]);
    expect(d.gaps[0].detail).toBe(
      "Earlier lookups gave different details for this slot: check_availability (result 2) said Tuesday, November 10, 9:00 AM; check_availability (result 2) said Wednesday, November 11, 11:00 AM.",
    );
  });

  it("an exact id match alone counts when a case-different id has other details", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [{ id: "recab", startsAt: "2026-11-06T15:00:00.000Z", providerName: "Dr. Amara Osei" }] }),
      ...tool("tc_2", "list_appointments", {}, { appointments: [{ id: "recAb", startsAt: "2026-11-06T09:00:00.000Z", providerName: "Dr. Priya Nair" }] }),
      ...tool("tc_3", "book_appointment", { slotId: "recAb", patientId: "pt-1" }, { ok: true }),
    ]);
    const d = committedDetails(e, WITH_APPOINTMENTS, changes(e, WITH_APPOINTMENTS)[0]);
    expect(d.fields).toEqual({ date: "2026-11-06T09:00:00.000Z", time: "2026-11-06T09:00:00.000Z", provider: "Dr. Priya Nair" });
    expect(d.unresolved).toEqual([]);
    expect(d.gaps).toEqual([]);
  });

  it("a disagreement only on a field the policy does not need leaves the change resolved, and that field out", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [nair("s-2", "2026-11-10T09:00:00.000Z")] }),
      ...tool("tc_2", "list_appointments", {}, { appointments: [osei("s-2", "2026-11-10T09:00:00.000Z")] }),
      ...tool("tc_3", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true }),
    ]);
    const d = committedDetails(e, WITH_APPOINTMENTS, changes(e, WITH_APPOINTMENTS)[0]);
    expect(d.fields).toEqual({ date: "2026-11-10T09:00:00.000Z", time: "2026-11-10T09:00:00.000Z" });
    expect(d.unresolved).toEqual([]);
    expect(d.gaps).toEqual([]);
  });

  it("a candidate that lacks a needed field disagrees with one that has it", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [{ id: "s-2" }] }),
      ...tool("tc_2", "list_appointments", {}, { appointments: [nair("s-2", "2026-11-10T09:00:00.000Z")] }),
      ...tool("tc_3", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true }),
    ]);
    const d = committedDetails(e, WITH_APPOINTMENTS, changes(e, WITH_APPOINTMENTS)[0]);
    expect(d.fields).toEqual({});
    expect(d.unresolved).toEqual(["date", "time"]);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0].detail).toContain("check_availability (result 2) said nothing");
  });

  it("never repeats a scrubbed placeholder in the gap text", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [{ id: "s-2", startsAt: "[date 1]", providerName: "[person name 1]" }] }),
      ...tool("tc_2", "list_appointments", {}, { appointments: [nair("s-2", "2026-11-10T09:00:00.000Z")] }),
      ...tool("tc_3", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true }),
    ]);
    const d = committedDetails(e, WITH_APPOINTMENTS, changes(e, WITH_APPOINTMENTS)[0]);
    expect(d.unresolved).toEqual(["date", "time"]);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0].detail).not.toContain("[date 1]");
    expect(d.gaps[0].detail).not.toContain("[person name 1]");
    expect(d.gaps[0].detail).toContain("check_availability (result 2) said date hidden by Retell");
  });

  it("candidates that write the same moment two ways agree", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [nair("s-2", "2026-11-10T09:00:00Z")] }),
      ...tool("tc_2", "list_appointments", {}, { appointments: [nair("s-2", "2026-11-10T09:00:00.000Z")] }),
      ...tool("tc_3", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true }),
    ]);
    const d = committedDetails(e, WITH_APPOINTMENTS, changes(e, WITH_APPOINTMENTS)[0]);
    expect(d.unresolved).toEqual([]);
    expect(d.gaps).toEqual([]);
  });

  it("three candidates, two agreeing and one not, still disagree", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [nair("s-2", "2026-11-10T09:00:00.000Z")] }),
      ...tool("tc_2", "check_availability", {}, { slots: [nair("s-2", "2026-11-10T09:00:00.000Z")] }),
      ...tool("tc_3", "list_appointments", {}, { appointments: [nair("s-2", "2026-11-11T10:00:00.000Z")] }),
      ...tool("tc_4", "book_appointment", { slotId: "s-2", patientId: "pt-1" }, { ok: true }),
    ]);
    const d = committedDetails(e, WITH_APPOINTMENTS, changes(e, WITH_APPOINTMENTS)[0]);
    expect(d.unresolved).toEqual(["date", "time"]);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0].seqs).toEqual([2, 4, 6, 7, 8]);
  });
});

describe("providerNames", () => {
  it("lists the distinct provider names the lookups offered, in order of first appearance", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [osei("s-1", "2026-11-06T09:00:00.000Z"), nair("s-2", "2026-11-06T10:00:00.000Z")] }),
      ...tool("tc_2", "check_availability", {}, { slots: [nair("s-3", "2026-11-06T11:00:00.000Z")] }),
    ]);
    expect(providerNames(e, PRESET)).toEqual(["Dr. Amara Osei", "Dr. Priya Nair"]);
  });

  it("skips placeholders, empty names and failed lookups", () => {
    const e = ev([
      ...tool("tc_1", "check_availability", {}, { slots: [{ id: "s-1", providerName: "[person name 1]" }, { id: "s-2", providerName: " " }] }),
      ...tool("tc_2", "check_availability", {}, { slots: [nair("s-3", "2026-11-06T11:00:00.000Z")] }, false),
    ]);
    expect(providerNames(e, PRESET)).toEqual([]);
  });

  it("is empty when the policy has no name field", () => {
    expect(providerNames(booked(), { ...PRESET, fields: {} })).toEqual([]);
  });

  it("reads a name field the change itself carries", () => {
    const policy: Policy = {
      packs: ["scheduling"],
      tools: { book: { role: "change", kind: "book" } },
      fields: { provider: { path: "args.doctor", type: "name" } },
    };
    const e = ev([...tool("tc_1", "book", { doctor: "Dr. Nair" }, { ok: true })]);
    expect(providerNames(e, policy)).toEqual(["Dr. Nair"]);
  });
});

describe("the samples", () => {
  const settled = (e: Evidence) => {
    const { policy } = policyFor(e);
    return { e: resolveOk(e, policy), policy };
  };

  it("every successful booking in a sample resolves its date, time and provider", () => {
    for (const sample of SAMPLE_REPORTS) {
      const { e, policy } = settled(sample.evidence);
      const bookings = successfulChanges(changes(e, policy)).filter((c) => c.kind === "book");
      for (const change of bookings) {
        const d = committedDetails(e, policy, change);
        expect(d.unresolved, sample.callId).toEqual([]);
        expect(Object.keys(d.fields).sort(), sample.callId).toEqual(["date", "provider", "time"]);
      }
    }
  });

  it("the passed sample's booking is Dr. Priya Nair at 2:00 p.m. UTC", () => {
    const { e, policy } = settled(SAMPLE_REPORTS.find((s) => s.verdict === "passed")!.evidence);
    const [change] = successfulChanges(changes(e, policy));
    const d = committedDetails(e, policy, change);
    expect(d.fields.provider).toBe("Dr. Priya Nair");
    expect(String(d.fields.time)).toMatch(/T14:00:00/);
    expect(providerNames(e, policy)).toContain("Dr. Priya Nair");
  });
});
