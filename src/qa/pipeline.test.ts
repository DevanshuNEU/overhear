import { describe, it, expect, afterEach, vi } from "vitest";

const testCtx = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ get db() { return testCtx.db; } }));
vi.mock("@/judge/judge", () => ({
  makeJudge: () => ({
    source: "claude",
    score: async () => ({
      no_hallucination: { key: "no_hallucination", tier: "subjective", score: 1, passed: true, confidence: 0.9, rationale: "" },
      conversational_quality: { key: "conversational_quality", tier: "subjective", score: 1, passed: true, confidence: 0.9, rationale: "" },
      safety_escalation: { key: "safety_escalation", tier: "subjective", score: 1, passed: true, confidence: 0.9, rationale: "" },
      failureCategories: [],
    }),
  }),
}));
vi.mock("@/judge/narrator", () => ({ summarizeCall: async () => "ok" }));

import { createTestDb } from "@/db/testing";
import { actionEvents, qaScores } from "@/db/schema";
import { scoreCall, type RetellCall } from "./pipeline";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());

describe("scoreCall", () => {
  it("scores a clean call to 100 and persists seven dimensions", async () => {
    ctx = await createTestDb();
    testCtx.db = ctx.db;
    await ctx.db.insert(actionEvents).values([
      { callId: "c1", tool: "verify_patient", args: {}, result: { verified: true }, ok: true, ts: new Date("2026-01-01T10:00:00Z") },
      { callId: "c1", tool: "book_appointment", args: {}, result: { ok: true }, ok: true, ts: new Date("2026-01-01T10:01:00Z") },
    ]);

    const out = await scoreCall({ call_id: "c1", transcript_object: [], transcript: "", call_analysis: {} } satisfies RetellCall);

    expect(out.composite).toBe(100);
    expect(out.callId).toBe("c1");
    expect(out.judgeSource).toBe("claude");

    const [row] = await ctx.db.select().from(qaScores);
    expect(row).toBeDefined();
    expect(row.composite).toBe(100);
    expect(row.judgeSource).toBe("claude");
    expect((row.dimensions as { key: string }[]).map((d) => d.key).sort()).toEqual(
      ["confirmed_before_acting", "conversational_quality", "correct_tool_use", "identity_verified", "no_hallucination", "safety_escalation", "task_success"],
    );
  });
});
