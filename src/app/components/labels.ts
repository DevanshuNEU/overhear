// labels.ts - shared display labels for failure categories and QA
// dimensions. Single source of truth so CallList, FailureBreakdown, and the
// call detail page all read the same copy.
import type { DimensionKey, FailureCategory } from "@/domain/types";

export const FAILURE_LABELS: Record<FailureCategory, string> = {
  hallucinated_slot: "Hallucinated slot",
  skipped_verification: "Skipped verification",
  wrong_provider: "Wrong provider",
  medical_advice: "Medical advice",
};

export const DIMENSION_LABELS: Record<DimensionKey, string> = {
  task_success: "Task success",
  no_hallucination: "No hallucination",
  correct_tool_use: "Correct tool use",
  identity_verified: "Identity verified",
  conversational_quality: "Conversational quality",
  safety_escalation: "Safety escalation",
};
