/* eslint-disable @typescript-eslint/no-explicit-any -- `db` must accept both the postgres-js DB
 * (production) and the PGlite test DB (createTestDb); their drizzle instance/transaction types
 * don't unify, same untyped boundary as clinic/service.ts and qa/queries.ts. */
// ensureDemoData - keeps the shared demo self-serving without any maintenance.
// Called on dashboard load (the step right before anyone places a call), it
// makes sure the test personas exist and that there are enough near-term open
// slots to book into, topping slots up only when they run low (they go stale by
// date and get consumed as people book). Everything here is idempotent and
// throttled so the dashboard's 5-second auto-refresh does not hammer the DB.
import { and, eq, gte, lt } from "drizzle-orm";
import type { DB } from "@/db/client";
import { appointmentSlots, patients, providers } from "@/db/schema";
import { DEMO_PERSONAS } from "./personas";

// Regenerate the rolling window whenever fewer than this many future open slots
// remain, which also covers slots being booked up during a busy demo.
const SLOT_FLOOR = 30;
const WINDOW_DAYS = 14; // generate slots across the next N days
const SLOT_HOURS = [9, 11, 14, 16]; // UTC hour of each daily slot
const THROTTLE_MS = 15 * 60 * 1000;

let lastRun = 0;

// Test-only: reset the module-level throttle so a test can drive two real runs.
export function __resetThrottleForTests(): void {
  lastRun = 0;
}

export async function ensureDemoData(db: DB | any, now: () => Date = () => new Date()): Promise<void> {
  const ts = now().getTime();
  if (ts - lastRun < THROTTLE_MS) return;
  lastRun = ts;

  await ensurePersonas(db);
  await ensureSlots(db, now);
}

async function ensurePersonas(db: DB | any): Promise<void> {
  for (const persona of DEMO_PERSONAS) {
    const [existing] = await db
      .select({ id: patients.id })
      .from(patients)
      .where(and(eq(patients.name, persona.name), eq(patients.dob, persona.dob)))
      .limit(1);
    if (!existing) {
      await db.insert(patients).values({ name: persona.name, dob: persona.dob });
    }
  }
}

async function ensureSlots(db: DB | any, now: () => Date): Promise<void> {
  const nowDate = now();

  // Slots hang off providers; the historical seed creates them. If the DB has
  // none yet there is nothing to attach slots to, so leave it to the seed.
  const provs = await db.select({ id: providers.id }).from(providers);
  if (provs.length === 0) return;

  // Take past-dated open slots out of service every run. Only open ones: a booked
  // slot in the past is real history and keeps its appointment. This runs before
  // the floor check so stale slots are always cleared, even when future slots are
  // plentiful.
  await db.delete(appointmentSlots).where(and(eq(appointmentSlots.status, "open"), lt(appointmentSlots.startsAt, nowDate)));

  const openFuture = await db
    .select({ id: appointmentSlots.id })
    .from(appointmentSlots)
    .where(and(eq(appointmentSlots.status, "open"), gte(appointmentSlots.startsAt, nowDate)));
  if (openFuture.length >= SLOT_FLOOR) return;

  // Skip any (provider, time) already on the books so a top-up never duplicates
  // a slot that is still in the future.
  const existing = await db
    .select({ providerId: appointmentSlots.providerId, startsAt: appointmentSlots.startsAt })
    .from(appointmentSlots)
    .where(gte(appointmentSlots.startsAt, nowDate));
  const existingKeys = new Set(
    existing.map((s: any) => `${s.providerId}@${new Date(s.startsAt).toISOString()}`),
  );

  const values: { providerId: string; startsAt: Date; status: "open" }[] = [];
  for (let day = 1; day <= WINDOW_DAYS; day++) {
    for (const hour of SLOT_HOURS) {
      const startsAt = new Date(nowDate);
      startsAt.setUTCDate(startsAt.getUTCDate() + day);
      startsAt.setUTCHours(hour, 0, 0, 0);
      for (const p of provs as { id: string }[]) {
        const key = `${p.id}@${startsAt.toISOString()}`;
        if (existingKeys.has(key)) continue;
        values.push({ providerId: p.id, startsAt, status: "open" });
      }
    }
  }
  if (values.length > 0) await db.insert(appointmentSlots).values(values);
}
