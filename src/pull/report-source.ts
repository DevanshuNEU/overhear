// The engine's reports behind getReport (src/report/store.ts): the call screen at /reports/{callId} for a call from the
// pull. It reads the pull store (src/pull/pull.ts) and, for a call the pull never listed, fetches that one call.
// - A report comes back as the stored object. getReport still checks it against CallReportSchema, so a bad engine
//   report shows the unreadable screen, never a wrong verdict.
// - Everything else is undefined, which getReport answers as not found: no_content, error, a call still pending in a
//   pull, no key (also after Disconnect), an id Retell cannot hold, Retell's 404 and any failed request.
// - The key is never read here. The single fetch goes through the pull store, which reads it, holds it in a closure
//   and uses the shared limiter (five in flight, one 429 pause).
import type { ReportSource } from "@/report/store";
import { analyzeCall } from "./analyzer";
import { fetchCall, getOutcome, type Analyze, type PullTuning } from "./pull";
import { RETELL_ID } from "./retell-source";

// Retell call ids are short tokens. Anything else is not a call, and is not sent to Retell.
export const CALL_ID = RETELL_ID;

export function makePullSource(deps: { analyze?: Analyze; tuning?: PullTuning } = {}): ReportSource {
  const analyze = deps.analyze ?? analyzeCall;
  return async (callId) => {
    if (!CALL_ID.test(callId)) return undefined;
    const known = getOutcome(callId);
    if (known) return known.outcome.kind === "report" ? known.outcome.report : undefined;
    try {
      const outcome = await fetchCall(callId, { analyze, ...deps.tuning });
      return outcome?.kind === "report" ? outcome.report : undefined;
    } catch {
      // A key file that cannot be trusted, or anything else: say only that there is no report. Nothing is quoted.
      return undefined;
    }
  };
}

export const pullSource: ReportSource = makePullSource();
