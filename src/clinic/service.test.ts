import { describe, it, expect, afterEach } from "vitest";
import { createTestDb, type TestDB } from "@/db/testing";
import { providers, appointmentSlots, patients, actionEvents } from "@/db/schema";
import { makeClinicService } from "./service";
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
    const b = await svc.bookAppointment("call_1", { patientId: pat.id, slotId: slot.id });
    const appointmentId = b.result.appointmentId!;

    const first = await svc.cancelAppointment("call_1", { appointmentId });
    expect(first.result.ok).toBe(true);

    const second = await svc.cancelAppointment("call_1", { appointmentId });
    expect(second.result.ok).toBe(false);
  });
});
