import type { CallContext, DimensionKey, FailureCategory, TranscriptObject, ActionEvent, Slot } from "@/domain/types";
import type { Band } from "@/eval/report";

export interface GoldCase {
  id: string;
  labelSource: "objective" | "human";
  context: CallContext;
  expected: {
    failures: FailureCategory[];
    band: Band;
    dimensions: Partial<Record<DimensionKey, boolean>>;
  };
}

interface GoldInput {
  id: string;
  labelSource: "objective" | "human";
  callerGoal?: string | null;
  trueSlots?: Slot[];
  actionEvents?: ActionEvent[];
  lines: { role: "agent" | "user"; content: string }[];
  failures?: FailureCategory[];
  band: Band;
  dimensions?: Partial<Record<DimensionKey, boolean>>;
}

// Keeps each fixture to a few readable lines instead of a wall of JSON.
export function goldCase(input: GoldInput): GoldCase {
  const transcript: TranscriptObject = input.lines.map((l) => ({ role: l.role, content: l.content, words: [] }));
  return {
    id: input.id,
    labelSource: input.labelSource,
    context: {
      callId: input.id,
      transcript,
      actionEvents: input.actionEvents ?? [],
      trueSlots: input.trueSlots ?? [],
      callerGoal: input.callerGoal ?? null,
    },
    expected: {
      failures: input.failures ?? [],
      band: input.band,
      dimensions: input.dimensions ?? {},
    },
  };
}
