// analyzeRecord and analyzeRetellCall: the engine's entry points. One raw record in, one Outcome out, and they never throw.
//
// The record is read by its platform's adapter, given the policy that fits it (policyFor), checked (checkCall) and the
// report validated against the schema before it goes out. A record with no transcript is no_content. A record the
// engine cannot read, a bug that throws, or a report the schema rejects is an error with a plain message: a wrong
// report is worse than none, so an invalid one is never returned.
import { NOT_A_CALL_RECORD } from "@/report/labels";
import { CallReportSchema, PolicySchema, type Policy } from "@/report/schema";
import { fromLiveKit, isLiveKitReport } from "./adapters/livekit";
import { fromRetell, type Adapted } from "./adapters/retell";
import { checkCall } from "./check";
import { policyFor, type PolicySource } from "./policy";
import { InputError, type Analyze, type EngineOptions, type Outcome } from "./types";

/** One Retell call in, one Outcome out. Kept for the callers that only ever hold Retell records. */
export const analyzeRetellCall: Analyze = (raw, opts): Outcome => run(fromRetell, raw, opts);

/**
 * One raw record from any platform in, one Outcome out. A record with a call_id (or holding one under `call`) is a
 * Retell call; one with chat_history.items and a job_id, room_id or sdk_version is a LiveKit session report. Both go
 * through the same pipeline, so every contract, the hang-up rule and the experience checks run unchanged.
 */
export const analyzeRecord: Analyze = (raw, opts): Outcome => {
  if (callIdOf(raw) !== null) return run(fromRetell, raw, opts);
  if (isLiveKitReport(raw)) return run(fromLiveKit, raw, opts);
  return { kind: "error", callId: null, message: `${NOT_A_CALL_RECORD.message} ${NOT_A_CALL_RECORD.fix}` };
};

function run(read: (raw: unknown) => Adapted, raw: unknown, opts: EngineOptions): Outcome {
  try {
    const adapted = read(raw);
    if (adapted.kind === "no_content") return adapted;
    const { policy, source } = chosenPolicy(adapted, opts);
    const report = checkCall(adapted.evidence, policy, { tz: opts.tz, policySource: source });
    const valid = CallReportSchema.safeParse(report);
    if (!valid.success) {
      const first = valid.error.issues[0];
      const where = first.path.length > 0 ? `${first.path.join(".")}: ` : "";
      return { kind: "error", callId: adapted.evidence.callId, message: `Couldn't check this call: the report it produced is not valid (${where}${first.message}).` };
    }
    return { kind: "report", report: valid.data };
  } catch (err) {
    const why = err instanceof InputError ? `${err.message} ${err.fix}` : `Couldn't check this call: ${err instanceof Error ? err.message : String(err)}`;
    return { kind: "error", callId: callIdOf(raw) ?? liveKitIdOf(raw), message: why };
  }
}

/** The team's policy when the caller gave one, else the preset or inferred policy for this call. */
function chosenPolicy(adapted: Extract<Adapted, { kind: "evidence" }>, opts: EngineOptions): { policy: Policy; source: PolicySource } {
  if (opts.policy === undefined) return policyFor(adapted.evidence, { agentId: adapted.agentId, demoAgentId: opts.demoAgentId });
  const valid = PolicySchema.safeParse(opts.policy);
  if (!valid.success) {
    const first = valid.error.issues[0];
    const where = first.path.length > 0 ? ` at ${first.path.join(".")}` : "";
    throw new InputError(`The policy is not valid (${first.message}${where}).`, "Fix the policy against docs/policy.md.");
  }
  return { policy: valid.data, source: "user" };
}

/** The record's call id, when it has a readable one: the record's own or the one a webhook body holds under call. */
function callIdOf(raw: unknown): string | null {
  try {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const rec = raw as Record<string, unknown>;
    const call = !("call_id" in rec) && typeof rec.call === "object" && rec.call !== null ? (rec.call as Record<string, unknown>) : rec;
    return typeof call.call_id === "string" && call.call_id !== "" ? call.call_id : null;
  } catch {
    return null;
  }
}

/** A LiveKit report's call id, when it has one: job_id, else room_id, else room. */
function liveKitIdOf(raw: unknown): string | null {
  if (!isLiveKitReport(raw)) return null;
  const id = [raw.job_id, raw.room_id, raw.room].find((v) => typeof v === "string" && v !== "");
  return typeof id === "string" ? id : null;
}
