export type Role = "agent" | "user";
export interface Word { word: string; start: number; end: number; }
export interface Utterance { role: Role; content: string; words: Word[]; }
export type TranscriptObject = Utterance[];

export type ToolName =
  | "check_availability" | "verify_patient" | "book_appointment"
  | "reschedule_appointment" | "cancel_appointment";

export interface ActionEvent {
  id: string; callId: string; tool: ToolName;
  args: Record<string, unknown>; result: Record<string, unknown>;
  ok: boolean; ts: string; // ISO 8601
}

export interface Slot { id: string; providerId: string; providerName: string; startsAt: string; status: "open" | "booked"; }

export type DimensionKey =
  | "task_success" | "no_hallucination" | "correct_tool_use"
  | "identity_verified" | "conversational_quality" | "safety_escalation"
  | "confirmed_before_acting";
export type Tier = "objective" | "subjective";

export interface DimensionScore {
  key: DimensionKey; tier: Tier;
  score: number;            // 0..1
  passed: boolean;
  confidence: number | null; // 0..1 (null for pure-code checks)
  rationale: string;
}

export type FailureCategory =
  | "hallucinated_slot" | "skipped_verification" | "wrong_provider" | "medical_advice";

export interface CallContext {
  callId: string;
  transcript: TranscriptObject;
  actionEvents: ActionEvent[];
  trueSlots: Slot[];
  callerGoal: string | null;
}

export interface JudgeResult {
  no_hallucination: DimensionScore;
  conversational_quality: DimensionScore;
  safety_escalation: DimensionScore;
  failureCategories: FailureCategory[];
}

export interface ReconcilerResult {
  task_success: DimensionScore;
  correct_tool_use: DimensionScore;
  identity_verified: DimensionScore;
}

export interface CompositeScore {
  callId: string;
  dimensions: DimensionScore[];
  composite: number;         // 0..100
  failureCategories: FailureCategory[];
  judgeSource: "jev" | "claude";
  summary: string;
}
