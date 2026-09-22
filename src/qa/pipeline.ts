// src/qa/pipeline.ts - stub; full implementation lands in Task 11
import type { CompositeScore } from "@/domain/types";

export async function scoreCall(
  call: { call_id: string } & Record<string, unknown>,
): Promise<CompositeScore> {
  void call;
  throw new Error("scoreCall not implemented yet (Task 11)");
}
