/* eslint-disable @typescript-eslint/no-explicit-any -- `db` must accept both the postgres-js DB
 * (production) and the PGlite test DB (createTestDb); their drizzle instance/transaction types
 * don't unify, so this service is intentionally untyped at the driver boundary. */
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { appointmentSlots, appointments, patients, providers, actionEvents } from "@/db/schema";
import type { Slot, ToolName } from "@/domain/types";

type Out<R> = { result: R };

// Real mishearings of patients' names score 0.74 to 0.79 against the name on
// file ("Divanshu Chulikar" vs "Devanshu Chicholikar"); unrelated names score
// under 0.5. The exact DOB match does most of the work; this only has to tell
// apart people who share a birthday.
const NAME_MATCH_THRESHOLD = 0.65;

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

// 1 - normalized Levenshtein distance over letters only, so case, spacing and
// punctuation from the transcript don't count against the caller.
export function nameSimilarity(a: string, b: string): number {
  const x = letters(a), y = letters(b);
  if (!x || !y) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

export function makeClinicService(db: DB | any, now: () => Date = () => new Date()) {
  async function log(callId: string, tool: ToolName, args: unknown, result: unknown, ok: boolean) {
    await db.insert(actionEvents).values({ callId, tool, args, result, ok, ts: now() });
  }
  return {
    async checkAvailability(callId: string, args: { providerName?: string; date?: string }): Promise<Out<{ slots: Slot[] }>> {
      const rows = await db.select({
        id: appointmentSlots.id, providerId: providers.id, providerName: providers.name,
        startsAt: appointmentSlots.startsAt, status: appointmentSlots.status,
      }).from(appointmentSlots).innerJoin(providers, eq(appointmentSlots.providerId, providers.id))
        .where(eq(appointmentSlots.status, "open"));
      const nowMs = now().getTime();
      const slots: Slot[] = rows
        // Never offer a slot whose time has already passed: a stale past-dated
        // open slot is out of service, not availability.
        .filter((r: any) => new Date(r.startsAt).getTime() >= nowMs)
        .filter((r: any) => !args.providerName || r.providerName === args.providerName)
        .filter((r: any) => !args.date || new Date(r.startsAt).toISOString().slice(0, 10) === args.date)
        .map((r: any) => ({ ...r, startsAt: new Date(r.startsAt).toISOString() }));
      const result = { slots };
      await log(callId, "check_availability", args, result, true);
      return { result };
    },
    // The name comes through speech-to-text and is rarely spelled right, while
    // the date of birth reliably is. So the DOB is the exact key and the name
    // only has to be close to one on file for that DOB.
    async verifyPatient(callId: string, args: { name: string; dob: string }): Promise<Out<{ verified: boolean; patientId?: string; patientName?: string }>> {
      const candidates = await db.select().from(patients).where(eq(patients.dob, args.dob));
      const best = candidates
        .map((p: any) => ({ p, sim: nameSimilarity(args.name ?? "", p.name) }))
        .sort((a: any, b: any) => b.sim - a.sim)[0];
      const result = best && best.sim >= NAME_MATCH_THRESHOLD
        ? { verified: true, patientId: best.p.id, patientName: best.p.name }
        : { verified: false };
      await log(callId, "verify_patient", args, result, true);
      return { result };
    },
    async bookAppointment(callId: string, args: { patientId: string; slotId: string }): Promise<Out<{ ok: boolean; appointmentId?: string }>> {
      const result = await db.transaction(async (tx: any) => {
        const [claimed] = await tx.update(appointmentSlots)
          .set({ status: "booked" })
          .where(and(eq(appointmentSlots.id, args.slotId), eq(appointmentSlots.status, "open")))
          .returning();
        if (!claimed) return { ok: false };
        const [appt] = await tx.insert(appointments)
          .values({ slotId: args.slotId, patientId: args.patientId }).returning();
        return { ok: true, appointmentId: appt.id };
      });
      await log(callId, "book_appointment", args, result, result.ok);
      return { result };
    },
    async cancelAppointment(callId: string, args: { appointmentId: string }): Promise<Out<{ ok: boolean }>> {
      const result = await db.transaction(async (tx: any) => {
        const [appt] = await tx.select().from(appointments).where(eq(appointments.id, args.appointmentId));
        if (!appt || appt.status !== "booked") return { ok: false };
        await tx.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, args.appointmentId));
        await tx.update(appointmentSlots).set({ status: "open" }).where(eq(appointmentSlots.id, appt.slotId));
        return { ok: true };
      });
      await log(callId, "cancel_appointment", args, result, result.ok);
      return { result };
    },
    async rescheduleAppointment(callId: string, args: { appointmentId: string; newSlotId: string }): Promise<Out<{ ok: boolean }>> {
      const result = await db.transaction(async (tx: any) => {
        const [appt] = await tx.select().from(appointments).where(eq(appointments.id, args.appointmentId));
        if (!appt || appt.status !== "booked") return { ok: false };
        const [claimed] = await tx.update(appointmentSlots)
          .set({ status: "booked" })
          .where(and(eq(appointmentSlots.id, args.newSlotId), eq(appointmentSlots.status, "open")))
          .returning();
        if (!claimed) return { ok: false };
        await tx.update(appointmentSlots).set({ status: "open" }).where(eq(appointmentSlots.id, appt.slotId));
        await tx.update(appointments).set({ slotId: args.newSlotId }).where(eq(appointments.id, args.appointmentId));
        return { ok: true };
      });
      await log(callId, "reschedule_appointment", args, result, result.ok);
      return { result };
    },
  };
}
export type ClinicService = ReturnType<typeof makeClinicService>;
