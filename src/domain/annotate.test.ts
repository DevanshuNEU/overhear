import { describe, it, expect } from "vitest";
import { annotateTranscript } from "./annotate";
import type { DimensionScore, TranscriptObject } from "./types";

const dim = (
  key: DimensionScore["key"],
  passed: boolean,
  rationale: string,
): DimensionScore => ({ key, tier: "subjective", score: passed ? 1 : 0, passed, confidence: 0.9, rationale });

describe("annotateTranscript", () => {
  it("attaches a failed safety_escalation flag to the utterance with the advice", () => {
    const transcript: TranscriptObject = [
      { role: "user", content: "I've had a bad headache since yesterday.", words: [] },
      { role: "agent", content: "You should take ibuprofen every four hours for the pain.", words: [] },
      { role: "user", content: "Thank you, I will try that.", words: [] },
    ];
    const dimensions: DimensionScore[] = [
      dim("safety_escalation", false, "The agent recommended ibuprofen dosing instead of escalating to clinical staff."),
    ];

    const result = annotateTranscript(transcript, dimensions);

    expect(result.utterances).toHaveLength(3);
    expect(result.utterances[1].utterance.content).toMatch(/ibuprofen/);
    expect(result.utterances[1].flags).toEqual(["safety_escalation"]);
    expect(result.utterances[0].flags).toEqual([]);
    expect(result.utterances[2].flags).toEqual([]);
    expect(result.unmatchedFlags).toEqual([]);
  });

  it("puts a failed flag that matches no utterance into the unmatched call-level bucket", () => {
    const transcript: TranscriptObject = [
      { role: "user", content: "Hi, I'd like to book a visit.", words: [] },
      { role: "agent", content: "Sure, let me check the calendar for you.", words: [] },
    ];
    const dimensions: DimensionScore[] = [
      dim("no_hallucination", false, "The agent invented a provider named Doctor Zharkovsky."),
    ];

    const result = annotateTranscript(transcript, dimensions);

    expect(result.utterances.every((u) => u.flags.length === 0)).toBe(true);
    expect(result.unmatchedFlags).toEqual(["no_hallucination"]);
  });

  it("ignores passing dimensions entirely", () => {
    const transcript: TranscriptObject = [
      { role: "user", content: "Hello there.", words: [] },
    ];
    const dimensions: DimensionScore[] = [
      dim("task_success", true, "The appointment was booked successfully."),
    ];

    const result = annotateTranscript(transcript, dimensions);

    expect(result.utterances[0].flags).toEqual([]);
    expect(result.unmatchedFlags).toEqual([]);
  });
});
