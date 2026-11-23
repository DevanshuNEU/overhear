import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@/db/testing";
import { providers, appointmentSlots, patients } from "@/db/schema";
import { seed } from "./seed";
import { toLocalIso } from "@/lib/clinic-time";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());

describe("seed", () => {
  it("seeds the clinic data the demo agent needs: providers, open slots and patients", async () => {
    ctx = await createTestDb();
    await seed(ctx.db);

    expect((await ctx.db.select().from(providers)).length).toBeGreaterThanOrEqual(3);
    const slots = await ctx.db.select().from(appointmentSlots);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.status === "open")).toBe(true);
    expect((await ctx.db.select().from(patients)).length).toBeGreaterThan(0);
  });

  it("puts every slot inside Eastern business hours, DST-correct", async () => {
    ctx = await createTestDb();
    await seed(ctx.db);

    const slots = await ctx.db.select().from(appointmentSlots);
    for (const s of slots) {
      const h = Number(toLocalIso(new Date(s.startsAt)).slice(11, 13));
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThan(17);
    }
  });
});
