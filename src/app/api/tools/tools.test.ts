import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/retell/verify", () => ({ verifyRetellSignature: (_b: string, s: string | null) => s === "good" }));
const testCtx = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ get db() { return testCtx.db; } }));

import { createTestDb } from "@/db/testing";
import { providers, appointmentSlots } from "@/db/schema";
import { POST as checkAvailability } from "./check-availability/route";

beforeEach(async () => {
  const { db } = await createTestDb();
  testCtx.db = db;
  const [p] = await db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
  await db.insert(appointmentSlots).values({ providerId: p.id, startsAt: new Date("2026-10-01T15:00:00Z") });
});

function reqOf(sig: string, body: unknown) {
  return new Request("http://x/api/tools/check-availability", {
    method: "POST", headers: { "x-retell-signature": sig }, body: JSON.stringify(body),
  });
}

describe("tool route", () => {
  it("401s on bad signature", async () => {
    const res = await checkAvailability(reqOf("bad", { name: "check_availability", call: { call_id: "c1" }, args: {} }));
    expect(res.status).toBe(401);
  });
  it("returns open slots on valid signature", async () => {
    const res = await checkAvailability(reqOf("good", { name: "check_availability", call: { call_id: "c1" }, args: {} }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toHaveLength(1);
  });
});
