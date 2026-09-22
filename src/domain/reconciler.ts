import type { ActionEvent, CallContext, DimensionKey, DimensionScore, ReconcilerResult } from "./types";

const MUTATIONS: ActionEvent["tool"][] = ["book_appointment", "reschedule_appointment", "cancel_appointment"];
const dim = (key: DimensionKey, passed: boolean, rationale: string): DimensionScore =>
  ({ key, tier: "objective", score: passed ? 1 : 0, passed, confidence: null, rationale });

export function reconcile(ctx: CallContext): ReconcilerResult {
  const events = [...ctx.actionEvents].sort((a, b) => a.ts.localeCompare(b.ts));
  const mutations = events.filter((e) => MUTATIONS.includes(e.tool));
  const firstVerify = events.find((e) => e.tool === "verify_patient" && e.result?.verified === true);

  const identityOk = mutations.length === 0
    ? true
    : !!firstVerify && mutations.every((m) => firstVerify.ts < m.ts);
  const taskOk = mutations.some((m) => m.result?.ok === true);
  const toolOk = mutations.every((m) => m.ok === true);

  return {
    identity_verified: dim("identity_verified", identityOk,
      identityOk ? "identity verified before any mutation" : "mutation occurred before/without verification"),
    task_success: dim("task_success", taskOk, taskOk ? "a mutation succeeded" : "no successful mutation"),
    correct_tool_use: dim("correct_tool_use", toolOk, toolOk ? "all tool calls succeeded" : "a tool call failed"),
  };
}
