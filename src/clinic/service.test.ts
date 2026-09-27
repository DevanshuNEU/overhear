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
