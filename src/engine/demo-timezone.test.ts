// @vitest-environment node
// OVE-75: the demo clinic moved from UTC to Eastern Time. A call that started on or after NORTHWIND_EASTERN_FROM is read
// in Eastern; an earlier one, or one with no start time, is read in UTC exactly as before.
import { describe, expect, it } from "vitest";
import type { Evidence } from "@/report/schema";
import { analyzeRetellCall } from "./analyze";
import { NORTHWIND_EASTERN_FROM, policyFor } from "./policy";
import { ev, type ItemSpec } from "./testing/build";
import { toRetell } from "./testing/retell";

const SLOT = { id: "s-1", providerId: "p-1", providerName: "Dr. Priya Nair", status: "open" };
const tool = (id: string, name: string, args: Record<string, unknown>, payload: unknown): ItemSpec[] => [
  { kind: "tool_call", id, name, args },
  { kind: "tool_result", id, ok: null, platformOk: true, payload },
];
const demoBooking = (startsAt: string, said: string, callStartMs: number | null): Evidence =>
  ev([
    ...tool("tc_1", "check_availability", {}, { slots: [{ ...SLOT, startsAt }] }),
    ...tool("tc_2", "verify_patient", { name: "Jordan Ellis", dob: "1985-03-14" }, { verified: true, patientId: "pt-1", patientName: "Jordan Ellis" }),
    ...tool("tc_3", "book_appointment", { slotId: "s-1", patientId: "pt-1" }, { ok: true, appointmentId: "a-1" }),
    { kind: "turn", role: "agent", text: said, startSec: 30, interrupted: null },
  ], { callStartMs });

const WINTER_SLOT = "2026-12-08T14:00:00.000Z"; // 9 a.m. in New York, 2 p.m. in UTC
const AFTER = Date.parse("2026-11-23T03:00:00Z");
const BEFORE = Date.parse("2026-11-20T15:00:00Z");
const NINE = "You're booked for Tuesday, December 8 at 9 AM with Dr. Priya Nair.";
const TWO = "You're booked for Tuesday, December 8 at 2 PM with Dr. Priya Nair.";

function reportOf(e: Evidence) {
  const out = analyzeRetellCall(toRetell(e), { tz: "Asia/Tokyo" });
  if (out.kind !== "report") throw new Error("no report");
  return out.report;
}

describe("the demo clinic's time zone", () => {
  it("Eastern era: 9 a.m. for a slot at 14:00Z reads passed", () => {
    const r = reportOf(demoBooking(WINTER_SLOT, NINE, AFTER));
    expect(r.policy.timezone).toBe("America/New_York");
    expect(r.verdict).toBe("passed");
  });

  it("Eastern era: the same 9 a.m. for a slot at 09:00Z is violated, the spoken time differs", () => {
    const r = reportOf(demoBooking("2026-12-08T09:00:00.000Z", NINE, AFTER));
    expect(r.results.find((x) => x.contract === "spoken_matches_committed")?.result).toBe("violated");
    expect(r.verdict).toBe("failed");
  });

  it("UTC era: before the switch 2 p.m. for 14:00Z passes and 9 a.m. fails, as always", () => {
    const ok = reportOf(demoBooking(WINTER_SLOT, TWO, BEFORE));
    expect(ok.policy.timezone).toBe("UTC");
    expect(ok.verdict).toBe("passed");
    expect(reportOf(demoBooking(WINTER_SLOT, NINE, BEFORE)).verdict).toBe("failed");
  });

  it("a confirmation that adds the caller's own time (\"9 a.m. Eastern, that's 6 a.m. your time\") is not a mismatch", () => {
    const said = "You're booked for Tuesday, December 8 at 9 a.m. Eastern, that's 6 a.m. your time, with Dr. Priya Nair.";
    const r = reportOf(demoBooking(WINTER_SLOT, said, AFTER));
    expect(r.results.find((x) => x.contract === "spoken_matches_committed")?.result).toBe("passed");
    expect(r.verdict).toBe("passed");
  });

  it("a call with no start time is read in UTC, the old behaviour", () => {
    const r = reportOf(demoBooking(WINTER_SLOT, TWO, null));
    expect(r.policy.timezone).toBe("UTC");
    expect(r.verdict).toBe("passed");
  });

  it("switches exactly at the cutover instant", () => {
    expect(policyFor(demoBooking(WINTER_SLOT, "x", NORTHWIND_EASTERN_FROM - 1)).policy.timezone).toBe("UTC");
    expect(policyFor(demoBooking(WINTER_SLOT, "x", NORTHWIND_EASTERN_FROM)).policy.timezone).toBe("America/New_York");
  });
});
