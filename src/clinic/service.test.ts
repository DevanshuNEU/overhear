import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDB } from "@/db/testing";
import { providers, appointmentSlots, patients, appointments, actionEvents } from "@/db/schema";
import { makeClinicService, MAX_SLOTS_OFFERED } from "./service";
import { eq } from "drizzle-orm";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());

async function fixture(db: TestDB) {
  const [p] = await db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
  const [slot] = await db.insert(appointmentSlots)
    .values({ providerId: p.id, startsAt: new Date("2026-10-01T15:00:00Z") }).returning();
  const [pat] = await db.insert(patients).values({ name: "Alex Kim", dob: "1990-04-02" }).returning();
  return { p, slot, pat };
}

describe("ClinicService", () => {
  it("books an open slot, verifies patient, and logs action events", async () => {
    ctx = await createTestDb();
    const { slot, pat } = await fixture(ctx.db);
    const svc = makeClinicService(ctx.db);

    const v = await svc.verifyPatient("call_1", { name: "Alex Kim", dob: "1990-04-02" });
    expect(v.result.verified).toBe(true);

    const b = await svc.bookAppointment("call_1", { patientId: pat.id, slotId: slot.id });
    expect(b.result.ok).toBe(true);

    const events = await ctx.db.select().from(actionEvents).where(eq(actionEvents.callId, "call_1"));
    expect(events.map((e) => e.tool).sort()).toEqual(["book_appointment", "verify_patient"]);
    const bookedSlot = await ctx.db.select().from(appointmentSlots).where(eq(appointmentSlots.id, slot.id));
    expect(bookedSlot[0].status).toBe("booked");
  });

  it("does not offer slots whose time has already passed", async () => {
    ctx = await createTestDb();
    const [p] = await ctx.db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
    const [past] = await ctx.db.insert(appointmentSlots)
      .values({ providerId: p.id, startsAt: new Date("2026-09-24T09:00:00Z") }).returning();
    const [future] = await ctx.db.insert(appointmentSlots)
      .values({ providerId: p.id, startsAt: new Date("2026-09-28T09:00:00Z") }).returning();
    const svc = makeClinicService(ctx.db, () => new Date("2026-09-26T12:00:00Z"));

    const out = await svc.checkAvailability("call_1", {});
    const ids = out.result.slots.map((s) => s.id);
    expect(ids).toContain(future.id);
    expect(ids).not.toContain(past.id);
  });

  it("still offers a slot at exactly the current moment (only strictly-past drop)", async () => {
    ctx = await createTestDb();
    const [p] = await ctx.db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
    const nowIso = "2026-09-26T12:00:00Z";
    const [atNow] = await ctx.db.insert(appointmentSlots)
      .values({ providerId: p.id, startsAt: new Date(nowIso) }).returning();
    const svc = makeClinicService(ctx.db, () => new Date(nowIso));

    const out = await svc.checkAvailability("call_1", {});
    expect(out.result.slots.map((s) => s.id)).toContain(atNow.id);
  });

  it("returns nothing when the requested date is already in the past", async () => {
    ctx = await createTestDb();
    const [p] = await ctx.db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
    await ctx.db.insert(appointmentSlots).values({ providerId: p.id, startsAt: new Date("2026-09-24T09:00:00Z") });
    const svc = makeClinicService(ctx.db, () => new Date("2026-09-26T12:00:00Z"));

    const out = await svc.checkAvailability("call_1", { date: "2026-09-24" });
    expect(out.result.slots).toHaveLength(0);
  });

  it("refuses to double-book a slot", async () => {
    ctx = await createTestDb();
    const { slot, pat } = await fixture(ctx.db);
    const svc = makeClinicService(ctx.db);
    await svc.verifyPatient("call_1", { name: "Alex Kim", dob: "1990-04-02" });
    await svc.bookAppointment("call_1", { patientId: pat.id, slotId: slot.id });
    const second = await svc.bookAppointment("call_1", { patientId: pat.id, slotId: slot.id });
    expect(second.result.ok).toBe(false);
  });

  it("returns verified:false for an unknown patient", async () => {
    ctx = await createTestDb();
    await fixture(ctx.db);
    const svc = makeClinicService(ctx.db);
    const v = await svc.verifyPatient("call_1", { name: "Nobody", dob: "2000-01-01" });
    expect(v.result.verified).toBe(false);
  });

  // Names arrive through speech-to-text, so they are never exact. These are the
  // real mishearings from production calls; the date of birth came through
  // correctly every time, so it is the exact key and the name is matched loosely.
  it("verifies a misheard name when the date of birth matches exactly", async () => {
    ctx = await createTestDb();
    await ctx.db.insert(patients).values([
      { name: "Devanshu Chicholikar", dob: "2000-02-09" },
      { name: "Aisha Rahman", dob: "1991-08-17" },
    ]);
    const svc = makeClinicService(ctx.db);
    for (const [name, dob] of [
      ["Divan Chuych Cholikar", "2000-02-09"],
      ["Divanshu Chulikar", "2000-02-09"],
      ["divanshu chicholikar ", "2000-02-09"],
      ["Ayushar Rahman", "1991-08-17"],
    ]) {
      const v = await svc.verifyPatient("call_1", { name, dob });
      expect(v.result.verified, name).toBe(true);
    }
  });

  it("returns the name on file so the agent can use the right one", async () => {
    ctx = await createTestDb();
    const [pat] = await ctx.db.insert(patients).values({ name: "Devanshu Chicholikar", dob: "2000-02-09" }).returning();
    const svc = makeClinicService(ctx.db);
    const v = await svc.verifyPatient("call_1", { name: "Divanshu Chulikar", dob: "2000-02-09" });
    expect(v.result).toEqual({ verified: true, patientId: pat.id, patientName: "Devanshu Chicholikar" });
  });

  it("does not verify a different person who shares the date of birth", async () => {
    ctx = await createTestDb();
    await ctx.db.insert(patients).values({ name: "Jordan Ellis", dob: "1985-03-14" });
    const svc = makeClinicService(ctx.db);
    const v = await svc.verifyPatient("call_1", { name: "Morgan Reyes", dob: "1985-03-14" });
    expect(v.result.verified).toBe(false);
  });

  it("does not verify the right name with the wrong date of birth", async () => {
    ctx = await createTestDb();
    await ctx.db.insert(patients).values({ name: "Devanshu Chicholikar", dob: "2000-02-09" });
    const svc = makeClinicService(ctx.db);
    const v = await svc.verifyPatient("call_1", { name: "Devanshu Chicholikar", dob: "2000-09-02" });
    expect(v.result.verified).toBe(false);
  });

  it("picks the closest name when two patients share a date of birth", async () => {
    ctx = await createTestDb();
    const [, aisha] = await ctx.db.insert(patients).values([
      { name: "Aisha Rahim", dob: "1991-08-17" },
      { name: "Aisha Rahman", dob: "1991-08-17" },
    ]).returning();
    const svc = makeClinicService(ctx.db);
    const v = await svc.verifyPatient("call_1", { name: "Aisha Rahman", dob: "1991-08-17" });
    expect(v.result.patientId).toBe(aisha.id);
  });

  it("refuses to cancel an already-cancelled appointment", async () => {
    ctx = await createTestDb();
    const { slot, pat } = await fixture(ctx.db);
    const svc = makeClinicService(ctx.db);
    await svc.verifyPatient("call_1", { name: "Alex Kim", dob: "1990-04-02" });
    const b = await svc.bookAppointment("call_1", { patientId: pat.id, slotId: slot.id });
    const appointmentId = b.result.appointmentId!;

    const first = await svc.cancelAppointment("call_1", { appointmentId });
    expect(first.result.ok).toBe(true);

    const second = await svc.cancelAppointment("call_1", { appointmentId });
    expect(second.result.ok).toBe(false);
  });

  // The agent's prompt says "verify first", but a prompt is not a guard. These
  // checks live in the service so a misbehaving agent cannot change another
  // patient's appointment, whatever it says on the call.
  describe("only changes appointments for the patient verified on this call", () => {
    async function twoPatients(db: TestDB) {
      const [p] = await db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
      const [s1, s2, s3] = await db.insert(appointmentSlots).values([
        { providerId: p.id, startsAt: new Date("2026-10-01T15:00:00Z") },
        { providerId: p.id, startsAt: new Date("2026-10-02T15:00:00Z") },
        { providerId: p.id, startsAt: new Date("2026-10-03T15:00:00Z") },
      ]).returning();
      const [marcus, dana] = await db.insert(patients).values([
        { name: "Marcus Lee", dob: "1980-01-01" },
        { name: "Dana Fields", dob: "1975-05-05" },
      ]).returning();
      // Dana books her own appointment on an earlier call.
      const svc = makeClinicService(db);
      await svc.verifyPatient("call_dana", { name: "Dana Fields", dob: "1975-05-05" });
      const danas = await svc.bookAppointment("call_dana", { patientId: dana.id, slotId: s1.id });
      return { svc, s1, s2, s3, marcus, dana, danasAppointment: danas.result.appointmentId! };
    }

    it("refuses to book before anyone is verified on the call", async () => {
      ctx = await createTestDb();
      const { slot, pat } = await fixture(ctx.db);
      const svc = makeClinicService(ctx.db);
      const b = await svc.bookAppointment("call_1", { patientId: pat.id, slotId: slot.id });
      expect(b.result).toEqual({ ok: false, error: "not_verified" });
      const [s] = await ctx.db.select().from(appointmentSlots).where(eq(appointmentSlots.id, slot.id));
      expect(s.status).toBe("open");
    });

    it("refuses to book for a patient other than the one verified", async () => {
      ctx = await createTestDb();
      const { svc, s2, dana } = await twoPatients(ctx.db);
      await svc.verifyPatient("call_marcus", { name: "Marcus Lee", dob: "1980-01-01" });
      const b = await svc.bookAppointment("call_marcus", { patientId: dana.id, slotId: s2.id });
      expect(b.result).toEqual({ ok: false, error: "not_owner" });
    });

    it("refuses to cancel another patient's appointment", async () => {
      ctx = await createTestDb();
      const { svc, danasAppointment } = await twoPatients(ctx.db);
      await svc.verifyPatient("call_marcus", { name: "Marcus Lee", dob: "1980-01-01" });
      const c = await svc.cancelAppointment("call_marcus", { appointmentId: danasAppointment });
      expect(c.result).toEqual({ ok: false, error: "not_owner" });
      const [appt] = await ctx.db.select().from(appointments).where(eq(appointments.id, danasAppointment));
      expect(appt.status).toBe("booked");
    });

    it("refuses to reschedule another patient's appointment", async () => {
      ctx = await createTestDb();
      const { svc, s1, s3, danasAppointment } = await twoPatients(ctx.db);
      await svc.verifyPatient("call_marcus", { name: "Marcus Lee", dob: "1980-01-01" });
      const r = await svc.rescheduleAppointment("call_marcus", { appointmentId: danasAppointment, newSlotId: s3.id });
      expect(r.result).toEqual({ ok: false, error: "not_owner" });
      const [appt] = await ctx.db.select().from(appointments).where(eq(appointments.id, danasAppointment));
      expect(appt.slotId).toBe(s1.id);
    });

    it("still lets the verified patient change their own appointment", async () => {
      ctx = await createTestDb();
      const { svc, s3, danasAppointment } = await twoPatients(ctx.db);
      await svc.verifyPatient("call_dana_2", { name: "Dana Fields", dob: "1975-05-05" });
      const r = await svc.rescheduleAppointment("call_dana_2", { appointmentId: danasAppointment, newSlotId: s3.id });
      expect(r.result.ok).toBe(true);
    });

    it("logs every refusal, so the QA pipeline sees the attempt", async () => {
      ctx = await createTestDb();
      const { svc, danasAppointment } = await twoPatients(ctx.db);
      await svc.cancelAppointment("call_marcus", { appointmentId: danasAppointment });
      const events = await ctx.db.select().from(actionEvents).where(eq(actionEvents.callId, "call_marcus"));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ tool: "cancel_appointment", ok: false, result: { ok: false, error: "not_verified" } });
    });
  });

  it("refuses a change when two patients were verified in the same instant", async () => {
    ctx = await createTestDb();
    const [p] = await ctx.db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
    const [slot] = await ctx.db.insert(appointmentSlots)
      .values({ providerId: p.id, startsAt: new Date("2026-10-01T15:00:00Z") }).returning();
    const [a] = await ctx.db.insert(patients).values([
      { name: "Marcus Lee", dob: "1980-01-01" },
      { name: "Dana Fields", dob: "1975-05-05" },
    ]).returning();
    // A frozen clock gives both verifications the same timestamp, so "the
    // latest verified patient" has no single answer.
    const svc = makeClinicService(ctx.db, () => new Date("2026-09-30T12:00:00Z"));
    await svc.verifyPatient("call_1", { name: "Marcus Lee", dob: "1980-01-01" });
    await svc.verifyPatient("call_1", { name: "Dana Fields", dob: "1975-05-05" });
    const b = await svc.bookAppointment("call_1", { patientId: a.id, slotId: slot.id });
    expect(b.result).toEqual({ ok: false, error: "not_verified" });
  });

  it("accepts the verified patient's id in any letter case", async () => {
    ctx = await createTestDb();
    const { slot, pat } = await fixture(ctx.db);
    const svc = makeClinicService(ctx.db);
    await svc.verifyPatient("call_1", { name: "Alex Kim", dob: "1990-04-02" });
    const b = await svc.bookAppointment("call_1", { patientId: pat.id.toUpperCase(), slotId: slot.id });
    expect(b.result.ok).toBe(true);
  });

  // The model sometimes invents ids. A malformed id used to throw inside
  // Postgres before the action was logged, so the failed attempt was invisible
  // to the reconciler and the tool route returned a 500.
  it("rejects and logs a malformed id instead of throwing", async () => {
    ctx = await createTestDb();
    await fixture(ctx.db);
    const svc = makeClinicService(ctx.db);
    await svc.verifyPatient("call_1", { name: "Alex Kim", dob: "1990-04-02" });
    const b = await svc.bookAppointment("call_1", { patientId: "patient-123", slotId: "tuesday-3pm" });
    expect(b.result).toEqual({ ok: false, error: "invalid_id" });
    const events = await ctx.db.select().from(actionEvents).where(eq(actionEvents.callId, "call_1"));
    expect(events.find((e) => e.tool === "book_appointment")).toMatchObject({ ok: false });
  });

  // The log must hold exactly what the agent was shown: the QA pipeline reads
  // it as "the slots the agent saw". The cap used to be applied after logging.
  it("returns and logs the same capped, time-ordered list of slots", async () => {
    ctx = await createTestDb();
    const [p] = await ctx.db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
    const times = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 10, 30 - i, 9)));
    await ctx.db.insert(appointmentSlots).values(times.map((startsAt) => ({ providerId: p.id, startsAt })));
    const svc = makeClinicService(ctx.db, () => new Date("2026-10-01T00:00:00Z"));

    const out = await svc.checkAvailability("call_1", {});
    expect(out.result.slots).toHaveLength(MAX_SLOTS_OFFERED);
    const starts = out.result.slots.map((s) => s.startsAt);
    expect(starts).toEqual([...starts].sort());
    const [logged] = await ctx.db.select().from(actionEvents).where(eq(actionEvents.callId, "call_1"));
    expect(logged.result).toEqual(out.result);
  });
});
