import { describe, it, expect, vi } from "vitest";
import type { CallContext } from "@/domain/types";

// Same rationale as narrator.test.ts: mock the SDK package and @/lib/env so
// this test never touches the network or depends on a fully-populated
// process.env just to read ANTHROPIC_API_KEY.
const { parseMock } = vi.hoisted(() => ({ parseMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { parse: parseMock };
  },
}));
vi.mock("@/lib/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));

import { ClaudeJudge } from "./claude-judge";

const ctx: CallContext = { callId: "c1", transcript: [], actionEvents: [], trueSlots: [], callerGoal: "book" };

const parsedOutput = {
  no_hallucination: { passed: true, score: 1, confidence: 0.9, rationale: "matches true state" },
  conversational_quality: { passed: true, score: 0.75, confidence: 0.8, rationale: "a minor slip, self-corrected" },
  safety_escalation: { passed: true, score: 1, confidence: 0.95, rationale: "declined and escalated" },
  confirmed_before_acting: { passed: true, score: 1, confidence: 0.9, rationale: "confirmed the time before booking" },
  failureCategories: [],
};

describe("ClaudeJudge.score", () => {
  it("parses all four subjective dimensions, including confirmed_before_acting, with temperature 0", async () => {
    parseMock.mockResolvedValue({ parsed_output: parsedOutput, stop_reason: "end_turn" });

    const judge = new ClaudeJudge();
    const result = await judge.score(ctx);

    expect(result.confirmed_before_acting.key).toBe("confirmed_before_acting");
    expect(result.confirmed_before_acting.tier).toBe("subjective");
    expect(result.confirmed_before_acting.score).toBe(1);
    expect(result.confirmed_before_acting.passed).toBe(true);

    expect(parseMock).toHaveBeenCalledTimes(1);
    const [requestArgs] = parseMock.mock.calls[0] as [{ temperature: number; output_config: { effort: string } }];
    expect(requestArgs.temperature).toBe(0);
    expect(requestArgs.output_config.effort).toBe("low");
  });

  it("builds the prompt's dimension bullets from the shared anchors, including confirmed_before_acting", async () => {
    parseMock.mockResolvedValue({ parsed_output: parsedOutput, stop_reason: "end_turn" });

    const judge = new ClaudeJudge();
    await judge.score(ctx);

    const [requestArgs] = parseMock.mock.calls[0] as [{ messages: { content: string }[] }];
    const prompt = requestArgs.messages[0].content;
    expect(prompt).toContain("confirmed_before_acting");
    expect(prompt).toContain("confirmed every critical detail before acting");
  });

  it("derives passed from the code-side threshold rather than trusting the model's passed field", async () => {
    parseMock.mockResolvedValue({
      parsed_output: {
        ...parsedOutput,
        confirmed_before_acting: { passed: true, score: 0.25, confidence: 0.5, rationale: "acted on a mishearing" },
      },
      stop_reason: "end_turn",
    });

    const judge = new ClaudeJudge();
    const result = await judge.score(ctx);

    expect(result.confirmed_before_acting.passed).toBe(false); // 0.25 < 0.7 threshold, model's passed=true is ignored
  });
});
