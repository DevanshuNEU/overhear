/* eslint-disable @typescript-eslint/no-explicit-any -- `db` must accept both the postgres-js DB
 * (production) and the PGlite test DB (createTestDb); their drizzle instance/transaction types
 * don't unify, so this service is intentionally untyped at the driver boundary. */
import { and, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { appointmentSlots, appointments, patients, providers, actionEvents } from "@/db/schema";
import type { Slot, ToolName } from "@/domain/types";

type Out<R> = { result: R };

export function makeClinicService(db: DB | any) {
  async function log(callId: string, tool: ToolName, args: unknown, result: unknown, ok: boolean) {
    await db.insert(actionEvents).values({ callId, tool, args, result, ok });
  }
  return {
    async checkAvailability(callId: string, args: { providerName?: string; date?: string }): Promise<Out<{ slots: Slot[] }>> {
      const rows = await db.select({
        id: appointmentSlots.id, providerId: providers.id, providerName: providers.name,
        startsAt: appointmentSlots.startsAt, status: appointmentSlots.status,
      }).from(appointmentSlots).innerJoin(providers, eq(appointmentSlots.providerId, providers.id))
        .where(eq(appointmentSlots.status, "open"));
      const slots: Slot[] = rows
        .filter((r: any) => !args.providerName || r.providerName === args.providerName)
        .filter((r: any) => !args.date || new Date(r.startsAt).toISOString().slice(0, 10) === args.date)
        .map((r: any) => ({ ...r, startsAt: new Date(r.startsAt).toISOString() }));
      const result = { slots };
      await log(callId, "check_availability", args, result, true);
      return { result };
    },
    async verifyPatient(callId: string, args: { name: string; dob: string }): Promise<Out<{ verified: boolean; patientId?: string }>> {
      const [row] = await db.select().from(patients)
        .where(and(eq(patients.name, args.name), eq(patients.dob, args.dob)));
      const result = row ? { verified: true, patientId: row.id } : { verified: false };
      await log(callId, "verify_patient", args, result, true);
      return { result };
    },
    async bookAppointment(callId: string, args: { patientId: string; slotId: string }): Promise<Out<{ ok: boolean; appointmentId?: string }>> {
      const result = await db.transaction(async (tx: any) => {
        const [slot] = await tx.select().from(appointmentSlots).where(eq(appointmentSlots.id, args.slotId));
        if (!slot || slot.status !== "open") return { ok: false };
        await tx.update(appointmentSlots).set({ status: "booked" }).where(eq(appointmentSlots.id, args.slotId));
        const [appt] = await tx.insert(appointments).values({ slotId: args.slotId, patientId: args.patientId }).returning();
        return { ok: true, appointmentId: appt.id };
      });
      await log(callId, "book_appointment", args, result, result.ok);
      return { result };
    },
    async cancelAppointment(callId: string, args: { appointmentId: string }): Promise<Out<{ ok: boolean }>> {
      const result = await db.transaction(async (tx: any) => {
        const [appt] = await tx.select().from(appointments).where(eq(appointments.id, args.appointmentId));
        if (!appt) return { ok: false };
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
        const [newSlot] = await tx.select().from(appointmentSlots).where(eq(appointmentSlots.id, args.newSlotId));
        if (!appt || !newSlot || newSlot.status !== "open") return { ok: false };
        await tx.update(appointmentSlots).set({ status: "open" }).where(eq(appointmentSlots.id, appt.slotId));
        await tx.update(appointmentSlots).set({ status: "booked" }).where(eq(appointmentSlots.id, args.newSlotId));
        await tx.update(appointments).set({ slotId: args.newSlotId }).where(eq(appointments.id, args.appointmentId));
        return { ok: true };
      });
      await log(callId, "reschedule_appointment", args, result, result.ok);
      return { result };
    },
  };
}
export type ClinicService = ReturnType<typeof makeClinicService>;
