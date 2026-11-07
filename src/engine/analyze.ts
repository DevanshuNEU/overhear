// analyzeRetellCall: the engine's entry point. One raw Retell record in, one Outcome out, and it never throws.
//
// The record is read by the Retell adapter, given the policy that fits it (policyFor), checked (checkCall) and the
// report validated against the schema before it goes out. A record with no transcript is no_content. A record the
// engine cannot read, a bug that throws, or a report the schema rejects is an error with a plain message: a wrong
// report is worse than none, so an invalid one is never returned.
import { CallReportSchema } from "@/report/schema";
import { fromRetell } from "./adapters/retell";
import { checkCall } from "./check";
import { policyFor } from "./policy";
import { InputError, type Analyze, type Outcome } from "./types";

export const analyzeRetellCall: Analyze = (raw, opts): Outcome => {
  try {
    const adapted = fromRetell(raw);
    if (adapted.kind === "no_content") return adapted;
    const { policy, source } = policyFor(adapted.evidence, { agentId: adapted.agentId, demoAgentId: opts.demoAgentId });
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
    return { kind: "error", callId: callIdOf(raw), message: why };
  }
};

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
