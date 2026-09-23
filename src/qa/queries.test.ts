import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@/db/testing";
import { calls, qaScores } from "@/db/schema";
import { listCalls, getCall, failureBreakdown, scoreTrend } from "./queries";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());

const dims = [
  { key: "task_success", tier: "objective", score: 1, passed: true, confidence: null, rationale: "" },
];

async function seed(db: (typeof ctx)["db"]) {
  await db.insert(calls).values([
    { id: "c1", transcript: [], recordingUrl: null, retellSentiment: "Positive", retellSummary: "All good", startedAt: new Date("2026-01-01T09:00:00Z") },
    { id: "c2", transcript: [], recordingUrl: null, retellSentiment: "Negative", retellSummary: "Went badly", startedAt: new Date("2026-01-02T09:00:00Z") },
  ]);
  await db.insert(qaScores).values([
    {
      callId: "c1", composite: 90, dimensions: dims, failureCategories: ["hallucinated_slot"],
      judgeSource: "claude", summary: "Went well overall", scoredAt: new Date("2026-01-01T10:00:00Z"),
    },
    {
      callId: "c2", composite: 40, dimensions: dims, failureCategories: ["hallucinated_slot", "medical_advice"],
      judgeSource: "jev", summary: "Failed verification", scoredAt: new Date("2026-01-02T10:00:00Z"),
    },
  ]);
}

describe("queries", () => {
  it("listCalls returns calls newest first with joined qa data", async () => {
    ctx = await createTestDb();
    await seed(ctx.db);

    const out = await listCalls(ctx.db);

    expect(out.map((c) => c.id)).toEqual(["c2", "c1"]);
    expect(out[0].composite).toBe(40);
    expect(out[0].status).toBe("scored");
    expect(out[0].failureCategories).toEqual(["hallucinated_slot", "medical_advice"]);
    expect(out[0].retellSentiment).toBe("Negative");
  });

  it("listCalls surfaces an ended-but-unscored call as processing, newest first", async () => {
    ctx = await createTestDb();
    await seed(ctx.db);
    // A call that has ended (calls row) but has no qa_scores row yet.
    await ctx.db.insert(calls).values({
      id: "c3", transcript: [], recordingUrl: null, retellSentiment: null, retellSummary: null,
      startedAt: new Date("2026-01-03T09:00:00Z"),
    });

    const out = await listCalls(ctx.db);

    expect(out.map((c) => c.id)).toEqual(["c3", "c2", "c1"]);
    expect(out[0].status).toBe("processing");
    expect(out[0].composite).toBeNull();
    expect(out[0].scoredAt).toBeNull();
    expect(out[0].failureCategories).toEqual([]);
  });

  it("getCall returns full detail for a known id and null for an unknown one", async () => {
    ctx = await createTestDb();
    await seed(ctx.db);

    const found = await getCall(ctx.db, "c1");
    expect(found?.summary).toBe("Went well overall");
    expect(found?.judgeSource).toBe("claude");
    expect(found?.retellSummary).toBe("All good");
    expect(found?.dimensions).toEqual(dims);
    expect(found?.composite).toBe(90);

    const missing = await getCall(ctx.db, "nope");
    expect(missing).toBeNull();
  });

  it("getCall returns a processing detail for an ended-but-unscored call", async () => {
    ctx = await createTestDb();
    await ctx.db.insert(calls).values({
      id: "c9", transcript: [], recordingUrl: null, retellSentiment: null, retellSummary: null,
      startedAt: new Date("2026-01-03T09:00:00Z"),
    });

    const found = await getCall(ctx.db, "c9");
    expect(found?.status).toBe("processing");
    expect(found?.composite).toBeNull();
    expect(found?.summary).toBeNull();
    expect(found?.judgeSource).toBeNull();
    expect(found?.dimensions).toEqual([]);
  });

  it("failureBreakdown counts categories across calls", async () => {
    ctx = await createTestDb();
    await seed(ctx.db);

    const out = await failureBreakdown(ctx.db);
    const byCategory = Object.fromEntries(out.map((o) => [o.category, o.count]));
    expect(byCategory.hallucinated_slot).toBe(2);
    expect(byCategory.medical_advice).toBe(1);
  });

  it("scoreTrend returns composite scores ordered chronologically", async () => {
    ctx = await createTestDb();
    await seed(ctx.db);

    const out = await scoreTrend(ctx.db);
    expect(out.map((o) => o.composite)).toEqual([90, 40]);
  });
});
