// src/db/seed.ts - the synthetic clinic data the demo agent needs: a few providers, a bank of open slots and a
// handful of fake patients. `db:seed` (`tsx src/db/seed.ts`) runs it against the real DB.

/* eslint-disable @typescript-eslint/no-explicit-any -- `db` must accept both the postgres-js DB
 * (production) and the PGlite test DB (createTestDb); their drizzle instance/transaction types
 * don't unify. Same untyped boundary as clinic/service.ts. */
import type { DB } from "@/db/client";
import { providers, appointmentSlots, patients } from "@/db/schema";

const at = (day: number, hour: number) =>
  new Date(`2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00Z`);

export async function seed(db: DB | any): Promise<void> {
  const [osei, nair, torres] = await db.insert(providers).values([
    { name: "Dr. Amara Osei", specialty: "Family Medicine" },
    { name: "Dr. Priya Nair", specialty: "Pediatrics" },
    { name: "Dr. Miguel Torres", specialty: "Internal Medicine" },
  ]).returning();

  await db.insert(appointmentSlots).values([
    { providerId: osei.id, startsAt: at(10, 9) },
    { providerId: osei.id, startsAt: at(11, 10) },
    { providerId: osei.id, startsAt: at(12, 11) },
    { providerId: osei.id, startsAt: at(13, 9) },
    { providerId: osei.id, startsAt: at(14, 10) },
    { providerId: nair.id, startsAt: at(10, 13) },
    { providerId: nair.id, startsAt: at(11, 14) },
    { providerId: nair.id, startsAt: at(12, 13) },
    { providerId: torres.id, startsAt: at(10, 15) },
    { providerId: torres.id, startsAt: at(13, 16) },
    { providerId: torres.id, startsAt: at(14, 15) },
  ]);

  await db.insert(patients).values([
    { name: "Jordan Ellis", dob: "1985-03-14" },
    { name: "Morgan Reyes", dob: "1990-07-22" },
    { name: "Casey Nguyen", dob: "1978-11-02" },
    { name: "Taylor Brooks", dob: "2000-01-30" },
    { name: "Sam Whitfield", dob: "1965-05-19" },
    { name: "Riley Chen", dob: "1992-09-08" },
    { name: "Alex Kim", dob: "1988-12-05" },
    { name: "Devon Park", dob: "1995-02-11" },
    { name: "Harper Vance", dob: "1993-06-25" },
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void (async () => {
    const { db } = await import("@/db/client");
    try {
      await seed(db);
      console.log("seed complete");
      process.exit(0);
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  })();
}
