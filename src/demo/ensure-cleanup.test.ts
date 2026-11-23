import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { and, eq, gte } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { actionEvents, appointmentSlots, calls, patients, providers, qaScores } from "@/db/schema";
import { makeClinicService } from "@/clinic/service";
import { ensureDemoData, __resetThrottleForTests } from "./ensure";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());
beforeEach(() => __resetThrottleForTests());

const at = new Date("2026-09-23T12:00:00Z");
const clockAt = (d: Date) => () => d;

async function bookAndCancel(startsAt: Date) {
  const [p] = await ctx.db.insert(providers).values({ name: "Dr. Demo", specialty: "Family Medicine" }).returning();
  const [slot] = await ctx.db.insert(appointmentSlots).values({ providerId: p.id, startsAt, status: "open" }).returning();
  const [pat] = await ctx.db.insert(patients).values({ name: "Pat Example", dob: "1994-07-14" }).returning();
  const svc = makeClinicService(ctx.db);
  await svc.verifyPatient("call_1", { name: "Pat Example", dob: "1994-07-14" });
  const booked = (await svc.bookAppointment("call_1", { patientId: pat.id, slotId: slot.id })).result;
  expect(booked.ok).toBe(true);
  const cancelled = (await svc.cancelAppointment("call_1", { appointmentId: (booked as { appointmentId: string }).appointmentId })).result;
  expect(cancelled.ok).toBe(true);
  return slot;
}

async function futureOpen(since: Date) {
  return ctx.db.select().from(appointmentSlots).where(and(eq(appointmentSlots.status, "open"), gte(appointmentSlots.startsAt, since)));
}

describe("ensureDemoData after a cancel", () => {
  it("still tops up once the cancelled appointment's slot is in the past", async () => {
    ctx = await createTestDb();
    const slot = await bookAndCancel(new Date("2026-09-24T13:00:00Z"));
    const later = new Date("2026-09-25T12:00:00Z");

    await ensureDemoData(ctx.db, clockAt(later));
    __resetThrottleForTests();
    await expect(ensureDemoData(ctx.db, clockAt(later))).resolves.toBeUndefined();

    expect((await futureOpen(later)).length).toBeGreaterThanOrEqual(30);
    // The slot a cancelled appointment points at is kept, so that row still resolves.
    expect(await ctx.db.select().from(appointmentSlots).where(eq(appointmentSlots.id, slot.id))).toHaveLength(1);
  });

  it("still tops up when a cancelled appointment's future slot is outside clinic hours", async () => {
    ctx = await createTestDb();
    const slot = await bookAndCancel(new Date("2026-09-24T08:00:00Z")); // 4 a.m. Eastern

    await expect(ensureDemoData(ctx.db, clockAt(at))).resolves.toBeUndefined();

    expect((await futureOpen(at)).length).toBeGreaterThanOrEqual(30);
    expect(await ctx.db.select().from(appointmentSlots).where(eq(appointmentSlots.id, slot.id))).toHaveLength(1);
  });
});

describe("ensureDemoData purge", () => {
  it("deletes action events older than a day, keeps newer ones, and empties the unused tables", async () => {
    ctx = await createTestDb();
    const hoursAgo = (h: number) => new Date(at.getTime() - h * 3600_000);
    await ctx.db.insert(actionEvents).values([
      { callId: "old", tool: "verify_patient", args: { name: "Pat Example", dob: "1994-07-14" }, result: { verified: false }, ok: true, ts: hoursAgo(25) },
      { callId: "new", tool: "verify_patient", args: { name: "Pat Example", dob: "1994-07-14" }, result: { verified: false }, ok: true, ts: hoursAgo(23) },
    ]);
    await ctx.db.insert(calls).values({ id: "call_old", transcript: [] });
    await ctx.db.insert(qaScores).values({ callId: "call_old", composite: 50, dimensions: [], failureCategories: [], judgeSource: "claude", summary: "x" });

    await ensureDemoData(ctx.db, clockAt(at));

    expect((await ctx.db.select().from(actionEvents)).map((r) => r.callId)).toEqual(["new"]);
    expect(await ctx.db.select().from(calls)).toHaveLength(0);
    expect(await ctx.db.select().from(qaScores)).toHaveLength(0);
  });
});
