import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { and, eq, gte, lt } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { appointmentSlots, patients, providers } from "@/db/schema";
import { ensureDemoData, __resetThrottleForTests } from "./ensure";
import { DEMO_PERSONAS } from "./personas";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());
beforeEach(() => __resetThrottleForTests());

const at = new Date("2026-09-23T12:00:00Z");
const clockAt = (d: Date) => () => d;

async function addProvider(db: (typeof ctx)["db"]) {
  const [p] = await db.insert(providers).values({ name: "Dr. Demo", specialty: "Family Medicine" }).returning();
  return p;
}

describe("ensureDemoData", () => {
  it("inserts the demo personas and is idempotent across runs", async () => {
    ctx = await createTestDb();

    await ensureDemoData(ctx.db, clockAt(at));
    __resetThrottleForTests();
    await ensureDemoData(ctx.db, clockAt(at));

    const rows = await ctx.db.select().from(patients);
    expect(rows).toHaveLength(DEMO_PERSONAS.length);
    expect(rows.map((r) => r.name)).toContain("Devanshu Chicholikar");
  });

  it("sweeps away past-dated open slots so they go out of service", async () => {
    ctx = await createTestDb();
    const p = await addProvider(ctx.db);
    await ctx.db.insert(appointmentSlots).values({
      providerId: p.id,
      startsAt: new Date("2026-09-20T09:00:00Z"), // before `at` (2026-09-23)
      status: "open",
    });

    await ensureDemoData(ctx.db, clockAt(at));

    const stale = await ctx.db
      .select()
      .from(appointmentSlots)
      .where(and(eq(appointmentSlots.status, "open"), lt(appointmentSlots.startsAt, at)));
    expect(stale).toHaveLength(0);
  });

  it("keeps booked past slots (real history) when sweeping", async () => {
    ctx = await createTestDb();
    const p = await addProvider(ctx.db);
    const [booked] = await ctx.db.insert(appointmentSlots).values({
      providerId: p.id,
      startsAt: new Date("2026-09-20T09:00:00Z"), // past, but booked
      status: "booked",
    }).returning();

    await ensureDemoData(ctx.db, clockAt(at));

    const still = await ctx.db.select().from(appointmentSlots).where(eq(appointmentSlots.id, booked.id));
    expect(still).toHaveLength(1);
  });

  it("generates only future-dated open slots when below the floor", async () => {
    ctx = await createTestDb();
    await addProvider(ctx.db);

    await ensureDemoData(ctx.db, clockAt(at));

    const slots = await ctx.db.select().from(appointmentSlots);
    expect(slots.length).toBeGreaterThanOrEqual(30);
    expect(slots.every((s) => s.status === "open")).toBe(true);
    expect(slots.every((s) => new Date(s.startsAt).getTime() > at.getTime())).toBe(true);
  });

  it("does not generate slots when enough future open slots already exist", async () => {
    ctx = await createTestDb();
    const p = await addProvider(ctx.db);
    // 40 future open slots, comfortably above the floor of 30.
    await ctx.db.insert(appointmentSlots).values(
      Array.from({ length: 40 }, (_, i) => ({
        providerId: p.id,
        startsAt: new Date(at.getTime() + (i + 1) * 3600_000),
        status: "open" as const,
      })),
    );

    await ensureDemoData(ctx.db, clockAt(at));

    const slots = await ctx.db.select().from(appointmentSlots);
    expect(slots).toHaveLength(40);
  });

  it("tops up when past-dated slots leave too few future ones", async () => {
    ctx = await createTestDb();
    const p = await addProvider(ctx.db);
    // Plenty of slots, but all in the past: they must not count toward the floor.
    await ctx.db.insert(appointmentSlots).values(
      Array.from({ length: 40 }, (_, i) => ({
        providerId: p.id,
        startsAt: new Date(at.getTime() - (i + 1) * 3600_000),
        status: "open" as const,
      })),
    );

    await ensureDemoData(ctx.db, clockAt(at));

    const future = await ctx.db
      .select()
      .from(appointmentSlots)
      .where(and(eq(appointmentSlots.status, "open"), gte(appointmentSlots.startsAt, at)));
    expect(future.length).toBeGreaterThanOrEqual(30);
  });

  it("short-circuits a second call inside the throttle window", async () => {
    ctx = await createTestDb();

    await ensureDemoData(ctx.db, clockAt(at));
    // Remove a persona, then call again at the same instant: the throttle should
    // skip all work, so the persona stays gone.
    await ctx.db.delete(patients).where(eq(patients.name, "Aisha Rahman"));
    await ensureDemoData(ctx.db, clockAt(at));

    const rows = await ctx.db.select().from(patients).where(eq(patients.name, "Aisha Rahman"));
    expect(rows).toHaveLength(0);
  });
});
