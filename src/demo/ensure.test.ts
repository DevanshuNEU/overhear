import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { and, eq, gte, lt } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { appointmentSlots, patients, providers } from "@/db/schema";
import { ensureDemoData, __resetThrottleForTests } from "./ensure";
import { DEMO_PERSONAS } from "./personas";
import { toLocalIso, zonedInstant } from "@/lib/clinic-time";

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
        startsAt: zonedInstant(2026, 9, 24 + i, 9), // 9 a.m. Eastern, inside clinic hours (Date.UTC rolls past the month end)
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

  it("creates slots at Eastern clinic hours, and keeps them there across the November clock change", async () => {
    ctx = await createTestDb();
    await addProvider(ctx.db);
    const before = new Date("2026-10-28T16:00:00Z"); // window runs across Sunday Nov 1

    await ensureDemoData(ctx.db, clockAt(before));

    const slots = await ctx.db.select().from(appointmentSlots);
    const eastern = slots.map((s) => toLocalIso(new Date(s.startsAt)).slice(11, 13));
    expect(new Set(eastern)).toEqual(new Set(["09", "11", "14", "16"]));
    // The UTC hour moves by one when daylight time ends: 13:00Z in October, 14:00Z in November.
    const nineAm = slots.filter((s) => toLocalIso(new Date(s.startsAt)).slice(11, 13) === "09").map((s) => new Date(s.startsAt).toISOString());
    expect(nineAm).toContain("2026-10-30T13:00:00.000Z");
    expect(nineAm).toContain("2026-11-02T14:00:00.000Z");
  });

  it("starts from the clinic's date when UTC has already rolled over", async () => {
    ctx = await createTestDb();
    await addProvider(ctx.db);

    await ensureDemoData(ctx.db, clockAt(new Date("2026-11-23T00:36:00Z"))); // 7:36 pm Sunday in New York

    const first = (await ctx.db.select().from(appointmentSlots)).map((s) => toLocalIso(new Date(s.startsAt))).sort()[0];
    expect(first).toBe("2026-11-23T09:00:00-05:00"); // Monday: tomorrow in New York, not Tuesday
  });

  it("deletes open future slots outside 8 to 17 Eastern, never booked, past or in-hours ones", async () => {
    ctx = await createTestDb();
    const p = await addProvider(ctx.db);
    const mk = (iso: string, status: "open" | "booked") => ({ providerId: p.id, startsAt: new Date(iso), status });
    const rows = await ctx.db.insert(appointmentSlots).values([
      mk("2026-09-25T08:00:00Z", "open"), // 4 a.m. Eastern: removed
      mk("2026-09-25T22:00:00Z", "open"), // 6 p.m. Eastern: removed
      mk("2026-09-26T08:00:00Z", "booked"), // 4 a.m. Eastern but booked: kept
      mk("2026-09-25T13:00:00Z", "open"), // 9 a.m. Eastern: kept
      mk("2026-09-25T12:00:00Z", "open"), // 8 a.m. Eastern: kept
      mk("2026-09-25T20:59:00Z", "open"), // 4:59 p.m. Eastern: kept
    ]).returning();

    await ensureDemoData(ctx.db, clockAt(at));

    const ids = new Set((await ctx.db.select().from(appointmentSlots)).map((s) => s.id));
    expect([rows[0], rows[1]].some((r) => ids.has(r.id))).toBe(false);
    expect([rows[2], rows[3], rows[4], rows[5]].every((r) => ids.has(r.id))).toBe(true);
  });

  it("is idempotent: a second run changes nothing", async () => {
    ctx = await createTestDb();
    await addProvider(ctx.db);

    await ensureDemoData(ctx.db, clockAt(at));
    const first = (await ctx.db.select().from(appointmentSlots)).map((s) => s.id).sort();
    __resetThrottleForTests();
    await ensureDemoData(ctx.db, clockAt(at));
    const second = (await ctx.db.select().from(appointmentSlots)).map((s) => s.id).sort();

    expect(second).toEqual(first);
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
