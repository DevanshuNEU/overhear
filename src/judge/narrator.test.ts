import { describe, it, expect, vi } from "vitest";
import type { DimensionScore, FailureCategory } from "@/domain/types";

// Same rationale as retell/verify.test.ts and web-call.test.ts: mock the SDK
// package and @/lib/env so this test never touches the network or depends on
// a fully-populated process.env just to read ANTHROPIC_API_KEY.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: createMock };
  },
}));
vi.mock("@/lib/env", () => ({ env: { ANTHROPIC_API_KEY: "test-key" } }));

import { summarizeCall } from "./narrator";

describe("summarizeCall", () => {
  it("passes through the model's paragraph and grounds the prompt in the failed dimension", async () => {
    const fixedParagraph =
      "The call handled scheduling well, but the agent hallucinated a provider that did not " +
      "match the true slot state, which is why it failed on no_hallucination.";
    createMock.mockResolvedValue({
      content: [{ type: "text", text: fixedParagraph }],
      stop_reason: "end_turn",
    });

    const dimensions: DimensionScore[] = [
      {
        key: "task_success", tier: "objective", score: 1, passed: true,
        confidence: null, rationale: "appointment was booked as requested",
      },
      {
        key: "no_hallucination", tier: "subjective", score: 0, passed: false,
        confidence: 0.9, rationale: "agent claimed Dr. Smith was available when true slots showed Dr. Lee",
      },
    ];
    const failureCategories: FailureCategory[] = ["hallucinated_slot"];

    const result = await summarizeCall({
      dimensions, failureCategories, transcriptText: "Agent: I can book you with Dr. Smith. User: great.",
    });

    expect(result).toBe(fixedParagraph);
    expect(result.length).toBeGreaterThan(0);
    expect(createMock).toHaveBeenCalledTimes(1);

    const [requestArgs] = createMock.mock.calls[0] as [{ messages: { content: string }[] }];
    const sentPrompt = requestArgs.messages[0].content;
    expect(sentPrompt).toContain("no_hallucination");
    expect(sentPrompt).toContain("agent claimed Dr. Smith was available when true slots showed Dr. Lee");
    expect(sentPrompt).toContain("hallucinated_slot");
  });
});
