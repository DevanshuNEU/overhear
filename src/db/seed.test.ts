import { describe, it, expect, afterEach, vi } from "vitest";
import type { DimensionScore } from "@/domain/types";

// Same seam as qa/pipeline.test.ts: seed() calls scoreCall(), which reads
// `db` from `@/db/client` and calls the judge/narrator. Mock all three so
// this test never touches Postgres, Claude, or Jev - only PGlite.
const testCtx = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ get db() { return testCtx.db; } }));

const perfectDim = (key: DimensionScore["key"]): DimensionScore =>
  ({ key, tier: "subjective", score: 1, passed: true, confidence: 0.9, rationale: "fixed fake judge" });

vi.mock("@/judge/judge", () => ({
  makeJudge: () => ({
    source: "claude",
    // A single fixed, perfect JudgeResult for every call. This means the
    // hermetic test below cannot observe the two judge-scored planted
    // failures (hallucinated_slot, medical_advice) - those need a live
    // ANTHROPIC_API_KEY and are verified manually, documented in the task
    // report. What this test can and does verify is the reconciler-scored
    // side of the dataset, which is deterministic and needs no LLM.
    score: async () => ({
      no_hallucination: perfectDim("no_hallucination"),
      conversational_quality: perfectDim("conversational_quality"),
      safety_escalation: perfectDim("safety_escalation"),
      confirmed_before_acting: perfectDim("confirmed_before_acting"),
      failureCategories: [],
    }),
  }),
}));
vi.mock("@/judge/narrator", () => ({ summarizeCall: async () => "fixed fake summary" }));

import { createTestDb } from "@/db/testing";
import { qaScores } from "@/db/schema";
import { seed } from "./seed";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());

async function scoreRow(callId: string) {
  const rows = await ctx.db.select().from(qaScores);
  const row = rows.find((r) => r.callId === callId);
  if (!row) throw new Error(`no qa_scores row for ${callId}`);
  return row;
}

function dimOf(dimensions: unknown, key: DimensionScore["key"]): DimensionScore {
  const d = (dimensions as DimensionScore[]).find((x) => x.key === key);
  if (!d) throw new Error(`no ${key} dimension`);
  return d;
}

describe("seed", () => {
  it("populates providers, slots, patients, calls, and qa_scores for the whole synthetic dataset", async () => {
    ctx = await createTestDb();
    testCtx.db = ctx.db;

    await seed(ctx.db);

    const rows = await ctx.db.select().from(qaScores);
    expect(rows.length).toBeGreaterThanOrEqual(8);
  });

  it("scores the clean calls high with a perfect fake judge", async () => {
    ctx = await createTestDb();
    testCtx.db = ctx.db;
    await seed(ctx.db);

    const rows = await ctx.db.select().from(qaScores);
    const cleanRows = rows.filter((r) => r.callId.startsWith("seed-clean-"));
    expect(cleanRows.length).toBeGreaterThanOrEqual(3);
    for (const row of cleanRows) {
      expect(row.composite).toBeGreaterThanOrEqual(90);
    }
  });

  it("flags the skipped-verification call: identity_verified fails deterministically, no LLM needed", async () => {
    ctx = await createTestDb();
    testCtx.db = ctx.db;
    await seed(ctx.db);

    const row = await scoreRow("seed-fail-skipped-verification");
    const identity = dimOf(row.dimensions, "identity_verified");
    expect(identity.passed).toBe(false);
  });

  it("flags the hallucinated-slot call: the booking attempt itself fails, so task_success and correct_tool_use fail deterministically", async () => {
    ctx = await createTestDb();
    testCtx.db = ctx.db;
    await seed(ctx.db);

    const row = await scoreRow("seed-fail-hallucinated-slot");
    expect(dimOf(row.dimensions, "task_success").passed).toBe(false);
    expect(dimOf(row.dimensions, "correct_tool_use").passed).toBe(false);
    // identity_verified is unaffected: verification did happen before the
    // (failed) booking attempt, isolating this failure to the hallucination.
    expect(dimOf(row.dimensions, "identity_verified").passed).toBe(true);
  });

  it("still records the wrong-provider and medical-advice calls, even though detecting those failures needs a live judge", async () => {
    ctx = await createTestDb();
    testCtx.db = ctx.db;
    await seed(ctx.db);

    const wrongProvider = await scoreRow("seed-fail-wrong-provider");
    const medicalAdvice = await scoreRow("seed-fail-medical-advice");
    // Both bookings succeed at the tool-call level (real, open slots), so the
    // reconciler alone sees nothing wrong here - that's expected. Only a
    // live judge reading the transcript can catch wrong_provider and
    // medical_advice; this test just confirms the rows exist and are scored.
    expect(dimOf(wrongProvider.dimensions, "task_success").passed).toBe(true);
    expect(dimOf(medicalAdvice.dimensions, "task_success").passed).toBe(true);
  });
});
