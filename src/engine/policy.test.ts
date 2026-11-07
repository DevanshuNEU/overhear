// @vitest-environment node
// Policy: which contracts a pack runs, the demo agent's preset, and the policy inferred from tool names for any
// other agent. Calls here are made up with the seed's names, or are the three scrubbed samples.
import { describe, expect, it } from "vitest";
import { PolicySchema, type Evidence, type Policy } from "@/report/schema";
import { SAMPLE_REPORTS, failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { ev, m1View, type ItemSpec } from "./testing/build";
import preset from "./presets/northwind-clinic.json";
import { M1_CONTRACTS, PACKS, contractsFor, inferPolicy, policyFor, roleFor, toolPolicy } from "./policy";

/** A tool call and its result, for ev(). */
function tool(id: string, name: string, args: Record<string, unknown>, payload: unknown, platformOk: boolean | null = true): ItemSpec[] {
  return [
    { kind: "tool_call", id, name, args },
    { kind: "tool_result", id, ok: null, platformOk, payload },
  ];
}

const SLOT = { id: "s-1", providerId: "p-1", providerName: "Dr. Priya Nair", startsAt: "2026-11-06T14:00:00.000Z", status: "open" };
const turn = (text: string): ItemSpec => ({ kind: "turn", role: "agent", text, startSec: null, interrupted: null });

/** A demo-shaped call: availability, verify, book. */
function demoCall(slots: unknown = { slots: [SLOT] }): Evidence {
  return ev([
    turn("Let me check."),
    ...tool("tc_1", "check_availability", {}, slots),
    ...tool("tc_2", "verify_patient", { name: "Jordan Ellis", dob: "1985-03-14" }, { verified: true, patientId: "pt-1" }),
    ...tool("tc_3", "book_appointment", { slotId: "s-1", patientId: "pt-1" }, { ok: true, appointmentId: "a-1" }),
  ]);
}

describe("packs", () => {
  it("maps packs to contracts in spec order", () => {
    expect(contractsFor(["scheduling"])).toEqual(["promise_backed", "spoken_matches_committed", "transfer_kept", "committed_matches_request"]);
    expect(contractsFor(["healthcare"])).toEqual([
      "promise_backed",
      "verified_before_change",
      "spoken_matches_committed",
      "transfer_kept",
      "committed_matches_request",
    ]);
    expect(contractsFor(["scheduling", "healthcare"])).toEqual(contractsFor(["healthcare"]));
    expect(contractsFor([])).toEqual([]);
  });

  it("runs the scheduling pack in M1", () => {
    expect(M1_CONTRACTS).toEqual(contractsFor(["scheduling"]));
    expect(PACKS.healthcare).toEqual(expect.arrayContaining([...PACKS.scheduling]));
  });
});

describe("the Northwind preset", () => {
  it("validates under PolicySchema and equals the sample policy except packs", () => {
    expect(PolicySchema.parse(preset)).toEqual(preset);
    for (const sample of SAMPLE_REPORTS) expect(preset).toEqual(m1View(sample).policy);
    expect(preset.packs).toEqual(["scheduling"]);
    expect(preset.timezone).toBe("UTC");
    expect(preset.tools.cancel_appointment.required).toEqual([]);
  });
});

describe("toolPolicy", () => {
  it("finds a tool by its exact name and nothing else", () => {
    const policy = PolicySchema.parse(preset);
    expect(toolPolicy(policy, "book_appointment")).toEqual({ role: "change", kind: "book", id: "args.slotId", patientId: "args.patientId" });
    expect(toolPolicy(policy, "Book_Appointment")).toBeUndefined();
    expect(toolPolicy(policy, "constructor")).toBeUndefined();
    expect(toolPolicy(policy, "__proto__")).toBeUndefined();
  });
});

describe("roleFor", () => {
  it("infers roles from common tool names", () => {
    expect(roleFor("verify_patient")).toEqual({ role: "verify" });
    expect(roleFor("authenticate_user")).toEqual({ role: "verify" });
    expect(roleFor("identifyCaller")).toEqual({ role: "verify" });
    expect(roleFor("transfer_call")).toEqual({ role: "transfer" });
    expect(roleFor("cancel_appointment")).toEqual({ role: "change", kind: "cancel" });
    expect(roleFor("reschedule_appointment")).toEqual({ role: "change", kind: "reschedule" });
    expect(roleFor("move_booking")).toEqual({ role: "change", kind: "reschedule" });
    expect(roleFor("book_appointment")).toEqual({ role: "change", kind: "book" });
    expect(roleFor("scheduleVisit")).toEqual({ role: "change", kind: "book" });
    expect(roleFor("create_reservation")).toEqual({ role: "change", kind: "book" });
    expect(roleFor("reserve-table")).toEqual({ role: "change", kind: "book" });
    expect(roleFor("update_address")).toEqual({ role: "change", kind: "update" });
    expect(roleFor("exchange_item")).toEqual({ role: "change", kind: "update" });
    expect(roleFor("return_order")).toEqual({ role: "change", kind: "update" });
    expect(roleFor("check_availability")).toEqual({ role: "lookup" });
    expect(roleFor("lookup_order")).toEqual({ role: "lookup" });
    expect(roleFor("searchFlights")).toEqual({ role: "lookup" });
    expect(roleFor("availability")).toEqual({ role: "lookup" });
  });

  describe("booking and appointment names", () => {
    const BOOK = ["make_booking", "submit_booking", "confirm_appointment", "make_appointment", "set_appointment", "add_appointment", "create_booking", "create_appointment", "schedule_appointment", "book_slot", "reserve_appointment"];
    const CANCEL = ["cancel_booking", "delete_appointment", "remove_appointment"];
    const RESCHEDULE = ["reschedule_booking", "move_appointment", "change_appointment"];
    const LOOKUP = ["get_bookings", "list_appointments", "find_slots", "search_availability", "get_available_slots"];
    const NOT_CHANGE = ["send_booking_confirmation_sms", "booking_faq", "get_booking_policy", "log_note", "send_sms"];

    it.each(BOOK)("%s books", (name) => expect(roleFor(name)).toEqual({ role: "change", kind: "book" }));
    it.each(CANCEL)("%s cancels", (name) => expect(roleFor(name)).toEqual({ role: "change", kind: "cancel" }));
    it.each(RESCHEDULE)("%s reschedules", (name) => expect(roleFor(name)).toEqual({ role: "change", kind: "reschedule" }));
    it.each(LOOKUP)("%s is a lookup", (name) => expect(roleFor(name)).toEqual({ role: "lookup" }));
    it.each(NOT_CHANGE)("%s is not a change", (name) => expect(roleFor(name)?.role).not.toBe("change"));

    it("reads camelCase names the same way", () => {
      expect(roleFor("makeBooking")).toEqual({ role: "change", kind: "book" });
      expect(roleFor("deleteAppointment")).toEqual({ role: "change", kind: "cancel" });
      expect(roleFor("changeAppointment")).toEqual({ role: "change", kind: "reschedule" });
    });

    it("needs the noun to end the name, so a booking's side tools stay undescribed", () => {
      expect(roleFor("add_booking_note")).toBeNull();
      expect(roleFor("confirm_booking_by_email")).toBeNull();
      expect(roleFor("delete_booking_reminder")).toBeNull();
    });

    it.each([
      "add_note_to_booking",
      "add_to_booking",
      "set_reminder_for_appointment",
      "make_payment_for_booking",
      "submit_feedback_for_appointment",
      "delete_note_from_booking",
      "remove_guest_from_reservation",
    ])("%s is a side tool, not a change", (name) => expect(roleFor(name)).toBeNull());

    it("needs the verb to sit directly before the noun", () => {
      expect(roleFor("make_booking")).toEqual({ role: "change", kind: "book" });
      expect(roleFor("confirm_appointments")).toEqual({ role: "change", kind: "book" });
      expect(roleFor("appointment_make_booking")).toEqual({ role: "change", kind: "book" });
    });

    it("leaves verbs without a booking noun alone", () => {
      expect(roleFor("set_timezone")).toBeNull();
      expect(roleFor("add_note")).toBeNull();
      expect(roleFor("confirm_email")).toBeNull();
      expect(roleFor("delete_item")).toBeNull();
      expect(roleFor("change_address")).toEqual({ role: "change", kind: "update" });
    });

    it("keeps update on an appointment an update", () => {
      expect(roleFor("update_appointment")).toEqual({ role: "change", kind: "update" });
    });
  });

  it("takes the first matching rule when a name matches two roles", () => {
    expect(roleFor("verify_and_book")).toEqual({ role: "verify" });
    expect(roleFor("book_and_transfer")).toEqual({ role: "transfer" });
    expect(roleFor("check_and_book")).toEqual({ role: "change", kind: "book" });
    expect(roleFor("reschedule_or_cancel")).toEqual({ role: "change", kind: "cancel" });
    expect(roleFor("find_and_update_order")).toEqual({ role: "change", kind: "update" });
  });

  it("matches whole words, so a lookup that names bookings is still a lookup", () => {
    expect(roleFor("get_bookings")).toEqual({ role: "lookup" });
    expect(roleFor("list_scheduled_visits")).toEqual({ role: "lookup" });
    expect(roleFor("remove_item")).toBeNull();
    expect(roleFor("end_call")).toBeNull();
    expect(roleFor("")).toBeNull();
  });
});

describe("inferPolicy", () => {
  it("infers the same roles, lookup items path, change ids and date, time and provider fields as the preset for the tools the failed sample calls", () => {
    const inferred = inferPolicy(failedSample.evidence);
    const names = ["verify_patient", "check_availability", "book_appointment"];
    expect(Object.keys(inferred.tools).sort()).toEqual([...names].sort());
    // patientId and the verify success path are the preset's own knowledge; inference cannot see them.
    expect(inferred.tools.verify_patient).toEqual({ role: "verify" });
    expect(inferred.tools.check_availability).toEqual(preset.tools.check_availability);
    expect(inferred.tools.book_appointment).toEqual({ role: "change", kind: "book", id: "args.slotId" });
    expect(inferred.fields).toEqual(preset.fields);
    expect(inferred.success).toBe(preset.success);
  });

  it("uses the scheduling pack, leaves the time zone unset and validates", () => {
    for (const sample of SAMPLE_REPORTS) {
      const inferred = inferPolicy(sample.evidence);
      expect(inferred.packs).toEqual(["scheduling"]);
      expect("timezone" in inferred).toBe(false);
      expect(PolicySchema.parse(inferred)).toEqual(inferred);
    }
  });

  it("leaves out tools whose names match no role, and gives an empty policy for a call with no tools", () => {
    const inferred = inferPolicy(ev([...tool("tc_1", "end_call", {}, "OK"), ...tool("tc_2", "lookup_order", { orderId: "o-1" }, { status: "shipped" })]));
    expect(inferred.tools).toEqual({ lookup_order: { role: "lookup" } });
    expect(inferPolicy(ev([turn("Hello.")]))).toEqual({ packs: ["scheduling"], tools: {}, fields: {} });
  });

  it("infers a success path from a boolean ok", () => {
    expect(inferPolicy(demoCall()).success).toBe("result.ok");
  });

  it("infers a success path from a boolean success", () => {
    const inferred = inferPolicy(ev(tool("tc_1", "book_appointment", { slotId: "s-1" }, { success: false })));
    expect(inferred.success).toBe("result.success");
  });

  it("gives each tool its own success path when tools disagree on the key", () => {
    const inferred = inferPolicy(
      ev([
        ...tool("tc_1", "book_appointment", {}, { ok: true }),
        ...tool("tc_2", "cancel_appointment", {}, { success: true }),
      ]),
    );
    expect(inferred.success).toBeUndefined();
    expect(inferred.tools.book_appointment.success).toBe("result.ok");
    expect(inferred.tools.cancel_appointment.success).toBe("result.success");
  });

  it("infers no success path from an ok that is not a boolean, or from text", () => {
    const inferred = inferPolicy(ev([...tool("tc_1", "book_appointment", {}, { ok: "yes" }), ...tool("tc_2", "cancel_order", {}, "OK")]));
    expect(inferred.success).toBeUndefined();
    expect(inferred.tools.book_appointment.success).toBeUndefined();
  });

  it("reads the first list of objects in a lookup result, skipping lists of text and empty lists", () => {
    const inferred = inferPolicy(ev(tool("tc_1", "find_slots", {}, { notes: ["a"], none: [], data: { open: [{ slot_id: "x", date: "2026-11-06" }] } })));
    expect(inferred.tools.find_slots).toEqual({ role: "lookup", items: "result.data.open", id: "item.slot_id" });
    expect(inferred.fields).toEqual({ date: { path: "item.date", type: "date", required: true } });
  });

  it("reads a result that is itself a list of objects, matched by slotId", () => {
    const inferred = inferPolicy(ev(tool("tc_1", "list_times", {}, [{ slotId: "x", start_time: "2026-11-06 14:00", doctor: "Dr. Nair" }])));
    expect(inferred.tools.list_times).toEqual({ role: "lookup", items: "result", id: "item.slotId" });
    expect(inferred.fields).toEqual({
      date: { path: "item.start_time", type: "date", required: true },
      time: { path: "item.start_time", type: "time", required: true },
      provider: { path: "item.doctor", type: "name" },
    });
  });

  it("finds a change id by the argument whose value equals an item id, ignoring case", () => {
    const inferred = inferPolicy(
      ev([
        ...tool("tc_1", "check_availability", {}, { slots: [{ id: "ABC-1", startsAt: "2026-11-06T14:00:00Z" }] }),
        ...tool("tc_2", "book_appointment", { note: "hi", chosen: "abc-1" }, { ok: true }),
        ...tool("tc_3", "cancel_appointment", { appointmentId: "a-9" }, { ok: true }),
      ]),
    );
    expect(inferred.tools.book_appointment).toEqual({ role: "change", kind: "book", id: "args.chosen" });
    expect(inferred.tools.cancel_appointment).toEqual({ role: "change", kind: "cancel" });
  });

  it("reads date and time from separate keys", () => {
    const inferred = inferPolicy(ev(tool("tc_1", "check_availability", {}, { slots: [{ id: "x", date: "2026-11-06", time: "2:00 p.m.", provider: "Dr. Nair" }] })));
    expect(inferred.fields).toEqual({
      date: { path: "item.date", type: "date", required: true },
      time: { path: "item.time", type: "time", required: true },
      provider: { path: "item.provider", type: "name" },
    });
  });

  it("takes fields from a change's arguments when no lookup lists items", () => {
    const inferred = inferPolicy(ev(tool("tc_1", "book_appointment", { datetime: "2026-11-06T14:00:00-05:00", providerName: "Dr. Nair" }, { ok: true })));
    expect(inferred.fields).toEqual({
      date: { path: "args.datetime", type: "date", required: true },
      time: { path: "args.datetime", type: "time", required: true },
      provider: { path: "args.providerName", type: "name" },
    });
  });

  it("does not read a field from a value that is not a date or time", () => {
    const inferred = inferPolicy(ev(tool("tc_1", "check_availability", {}, { slots: [{ id: "x", date: "soon", time: 14, provider: { name: "Dr. Nair" } }] })));
    expect(inferred.fields).toEqual({});
  });
});

describe("policyFor", () => {
  it("picks the preset for the demo agent, with UTC", () => {
    for (const sample of [failedSample, passedSample]) {
      const { policy, source } = policyFor(sample.evidence);
      expect(source).toBe("preset");
      expect(policy).toEqual(preset);
      expect(policy.timezone).toBe("UTC");
    }
    expect(policyFor(demoCall()).source).toBe("preset");
  });

  it("picks the preset for a demo call with no lookup, when every tool is the demo's", () => {
    const call = ev([
      ...tool("tc_1", "verify_patient", {}, { verified: true, patientId: "pt-1" }),
      ...tool("tc_2", "cancel_appointment", { appointmentId: "a-1" }, { ok: true }),
    ]);
    expect(policyFor(call).source).toBe("preset");
  });

  it("infers for an unknown agent, with no time zone", () => {
    const { policy, source } = policyFor(ev(tool("tc_1", "lookup_order", { orderId: "o-1" }, { order: { id: "o-1" } })));
    expect(source).toBe("inferred");
    expect(policy.tools).toEqual({ lookup_order: { role: "lookup" } });
    expect(policy.timezone).toBeUndefined();
  });

  it("infers, not the preset, for a call with the same tool names but a different lookup shape", () => {
    const sameNames = demoCall({ slots: [{ id: "s-1", start: "2026-11-06T14:00:00Z" }] });
    expect(policyFor(sameNames).source).toBe("inferred");
    expect(policyFor(demoCall({ availability: [SLOT] })).source).toBe("inferred");
    expect(policyFor(demoCall({ slots: "none" })).source).toBe("inferred");
  });

  it("infers when the call uses a tool the preset does not know", () => {
    const call = ev([...tool("tc_1", "check_availability", {}, { slots: [SLOT] }), ...tool("tc_2", "transfer_call", {}, { ok: true })]);
    expect(policyFor(call).source).toBe("inferred");
  });

  it("infers for a call with no tools: tool names are the only way to tell", () => {
    expect(policyFor(ev([turn("Hello.")])).source).toBe("inferred");
  });

  // Tool names alone are too common, so a lookup that only failed says nothing about whose agent this is.
  it("infers when the call's only lookup failed, as in the needs-review sample", () => {
    expect(policyFor(needsReviewSample.evidence).source).toBe("inferred");
    expect(policyFor(demoCall("HTTP 500: Request failed with status code 500")).source).toBe("inferred");
  });

  // A lookup that errored says nothing either way, so it neither makes a call the demo's nor stops it being one.
  // A call still needs one positive sign: a lookup answered in the demo's shape, or a tool only the preset knows.
  describe("a lookup that errored is neutral", () => {
    const failedLookup = (id: string) => tool(id, "check_availability", {}, "HTTP 500: Request failed", false);

    it("keeps the preset when a retry answered in the demo's shape", () => {
      const retry = ev([turn("Let me check."), ...failedLookup("tc_1"), ...tool("tc_2", "check_availability", {}, { slots: [SLOT] }), ...tool("tc_3", "book_appointment", { slotId: "s-1" }, { ok: true })]);
      expect(policyFor(retry).source).toBe("preset");
    });

    // A positive sign comes from what a result says, never from a tool's name: names alone are too common.
    it("keeps the preset when another preset tool's result has the demo's shape", () => {
      const verify = ev([turn("Let me check."), ...failedLookup("tc_1"), ...tool("tc_2", "verify_patient", {}, { verified: true, patientId: "pt-1" })]);
      expect(policyFor(verify).source).toBe("preset");
      const book = ev([...failedLookup("tc_1"), ...tool("tc_2", "book_appointment", { slotId: "s-1" }, { ok: true, appointmentId: "a-1" })]);
      expect(policyFor(book).source).toBe("preset");
    });

    it("infers when a preset tool is called but no result shows the demo's shape", () => {
      const book = (payload: unknown, platformOk: boolean | null = true) => ev([...failedLookup("tc_1"), ...tool("tc_2", "book_appointment", { slotId: "s-1" }, payload, platformOk)]);
      expect(policyFor(book("Booked")).source).toBe("inferred");
      expect(policyFor(book({ status: "confirmed" })).source).toBe("inferred");
      expect(policyFor(book({ ok: true }, false)).source).toBe("inferred");
      expect(policyFor(ev([...failedLookup("tc_1"), { kind: "tool_call", id: "tc_2", name: "book_appointment", args: {} }])).source).toBe("inferred");
      const verify = ev([...failedLookup("tc_1"), ...tool("tc_2", "verify_patient", {}, { verified: "yes" })]);
      expect(policyFor(verify).source).toBe("inferred");
    });

    it("infers when the errored lookup is all there is, or all the call's lookups that answered are not the demo's", () => {
      expect(policyFor(ev([...failedLookup("tc_1")])).source).toBe("inferred");
      expect(policyFor(ev([...failedLookup("tc_1"), ...tool("tc_2", "check_availability", {}, { slots: [{ id: "s-1", start: "2026-11-06T14:00:00Z" }] })])).source).toBe("inferred");
    });

    it("infers when a lookup that did not fail answered in another shape, whatever else the call did", () => {
      const call = ev([...failedLookup("tc_1"), ...tool("tc_2", "check_availability", {}, "no slots"), ...tool("tc_3", "verify_patient", {}, { verified: true, patientId: "pt-1" })]);
      expect(policyFor(call).source).toBe("inferred");
    });

    it("infers when a tool the preset does not name is called, errored lookup or not", () => {
      expect(policyFor(ev([...failedLookup("tc_1"), ...tool("tc_2", "transfer_call", {}, { ok: true })])).source).toBe("inferred");
    });
  });

  it("hands out a copy of the preset, so a caller cannot change it for the next call", () => {
    const first = policyFor(failedSample.evidence).policy as Policy;
    first.tools.book_appointment.kind = "cancel";
    first.packs.push("healthcare");
    expect(policyFor(failedSample.evidence).policy).toEqual(preset);
  });
});
