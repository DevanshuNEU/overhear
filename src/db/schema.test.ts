import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "./testing";
import { providers, appointmentSlots } from "./schema";
import { eq } from "drizzle-orm";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());

describe("schema", () => {
  it("inserts a provider and an open slot", async () => {
    ctx = await createTestDb();
    const [p] = await ctx.db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
    const [s] = await ctx.db.insert(appointmentSlots)
      .values({ providerId: p.id, startsAt: new Date("2026-10-01T15:00:00Z") }).returning();
    expect(s.status).toBe("open");
    const open = await ctx.db.select().from(appointmentSlots).where(eq(appointmentSlots.status, "open"));
    expect(open).toHaveLength(1);
  });
});
