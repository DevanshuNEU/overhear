// Small types the whole engine shares. The report's own types come from @/report/schema and are never copied here.
//
// The engine is called from three places: the eval harness (a stored call record and its expected verdict), the
// local Retell pull (one record per call), and later a pinned call kept as a regression test. All three hand over
// plain data and read plain data back, so the entry point has one shape, Analyze, and is pure: the same record
// and options give the same Outcome on any machine.
import type { NoContentReason } from "@/report/labels";
import type { CallReport, Policy } from "@/report/schema";

/** A record the engine cannot read at all, with what the caller can do about it. */
export class InputError extends Error {
  override name = "InputError";

  constructor(
    message: string,
    public fix: string,
  ) {
    super(message);
  }
}

/** What the caller decides, never the engine: the engine reads no clock and no machine settings. */
export interface EngineOptions {
  /** IANA time zone for spoken dates and times when the agent's policy names none, such as "America/New_York". */
  tz: string;
  /**
   * The Retell agent id of the demo agent, when the caller has one. A call that carries an agent id gets the demo's
   * preset only when its id equals this; with none set, it never does. A call with no agent id is judged by the
   * shape of its results. The engine reads no environment, so the caller passes it in.
   */
  demoAgentId?: string;
  /**
   * The team's own policy (docs/policy.md), when it has one. It is used for every call, instead of the preset or an
   * inferred policy, and the engine checks it with PolicySchema first (an invalid one is an error outcome, never a
   * guess). A user policy promises it names every tool the agent has, so it counts like the preset: a transfer that
   * was promised and never made reads Failed, not Couldn't check, when the policy lists no transfer tool.
   * The promise is checked per call: a call that used a tool the policy does not name gets the cautious (inferred)
   * reading, still with the policy's tools and fields.
   */
  policy?: Policy;
}

/**
 * What one call record turns into. A report always validates under CallReportSchema. no_content is a call with no
 * transcript of any kind, with the reason (NO_CONTENT_LINE in @/report/labels says it in words). error is a record
 * the engine could not turn into a valid report, with a plain message and the call id when the record had one.
 * Every kind is plain data, safe to store, send or compare, and the call id keys it in a list or an eval run.
 */
export type Outcome =
  | { kind: "report"; report: CallReport }
  | { kind: "no_content"; callId: string; reason: NoContentReason }
  | { kind: "error"; callId: string | null; message: string };

/** The engine's entry point: one raw platform record in, one Outcome out. Never throws. */
export type Analyze = (raw: unknown, opts: EngineOptions) => Outcome;
