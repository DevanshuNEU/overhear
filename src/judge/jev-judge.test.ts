import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallContext } from "@/domain/types";

// Same rationale as narrator.test.ts: mock @/lib/env so this test never
// depends on a fully-populated process.env just to read JEV_API_KEY, and
// mock global.fetch so no live call to api.typesafe.ai is ever made.
vi.mock("@/lib/env", () => ({ env: { JEV_API_KEY: "test-jev-key" } }));

import { JevJudge } from "./jev-judge";

const ctx: CallContext = {
  callId: "c1",
  transcript: [],
  actionEvents: [],
  trueSlots: [
    { id: "s1", providerId: "p1", providerName: "Dr. Lee", startsAt: "2026-09-22T10:00:00Z", status: "open" },
  ],
  callerGoal: "book",
};

// A representative response in the real System One shape confirmed from
// docs.typesafe.ai/api and docs.typesafe.ai/primitives: { model, answers,
// usage }, with a "noul" answer for the boolean question, "score" answers
// with a float position along the ordered criteria levels, and a "choice"
// answer naming one option.
function fakeSystemOneResponse() {
  return {
    model: "jev-latest",
    answers: {
      no_hallucination: { type: "noul", noul: 0.92 },
      conversational_quality: { type: "score", score: 3.2, confidence: 0.8 },
      safety_escalation: { type: "score", score: 4, confidence: 0.95 },
      failure_category: { type: "choice", choice: "hallucinated_slot", confidence: 0.6 },
    },
    usage: { input_tokens: 512, output_tokens: 0 },
  };
}

describe("JevJudge._callModel", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => fakeSystemOneResponse(),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the real System One endpoint with a Bearer key and one question map", async () => {
    const judge = new JevJudge();
    // @ts-expect-error - _callModel is protected, reached directly in tests same as judge.test.ts
    await judge._callModel(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer test-jev-key");

    const body = JSON.parse(init.body);
    expect(body.model).toBe("jev-latest");
    expect(Object.keys(body.questions)).toEqual([
      "no_hallucination", "conversational_quality", "safety_escalation", "failure_category",
    ]);
    expect(body.questions.no_hallucination.type).toBe("noul");
    expect(body.questions.conversational_quality.type).toBe("score");
    expect(body.questions.failure_category.type).toBe("choice");
  });

  it("maps a noul/score/choice response into RawScores", async () => {
    const judge = new JevJudge();
    // @ts-expect-error - _callModel is protected, reached directly in tests same as judge.test.ts
    const raw = await judge._callModel(ctx);

    expect(raw.no_hallucination).toEqual({
      passed: true,
      score: 0.92,
      confidence: 0.92,
      rationale: "jev noul question: no_hallucination vs trueSlots",
    });
    // 5 ordered levels (indices 0..4): score 3.2 -> 3.2 / 4 = 0.8
    expect(raw.conversational_quality.score).toBeCloseTo(0.8);
    expect(raw.conversational_quality.passed).toBe(true);
    expect(raw.conversational_quality.confidence).toBe(0.8);
    // score 4 -> 4 / 4 = 1
    expect(raw.safety_escalation.score).toBeCloseTo(1);
    expect(raw.safety_escalation.passed).toBe(true);
    // Choice returns exactly one option - honoring the array shape but never
    // populating more than one entry from a single call.
    expect(raw.failureCategories).toEqual(["hallucinated_slot"]);
  });

  it("maps a 'none' choice to an empty failureCategories array", async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ...fakeSystemOneResponse(),
        answers: { ...fakeSystemOneResponse().answers, failure_category: { type: "choice", choice: "none" } },
      }),
    }));
    const judge = new JevJudge();
    // @ts-expect-error - _callModel is protected, reached directly in tests same as judge.test.ts
    const raw = await judge._callModel(ctx);
    expect(raw.failureCategories).toEqual([]);
  });

  it("throws a descriptive error on a non-ok response", async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const judge = new JevJudge();
    // @ts-expect-error - _callModel is protected, reached directly in tests same as judge.test.ts
    await expect(judge._callModel(ctx)).rejects.toThrow(/systemone request failed with status 503/);
  });
});
