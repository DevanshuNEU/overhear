// Small types the whole engine shares. The report's own types come from @/report/schema and are never copied here.
//
// The engine is called from three places: the eval harness (a stored call record and its expected verdict), the
// local Retell pull (one record per call), and later a pinned call kept as a regression test. All three hand over
// plain data and read plain data back, so the entry point has one shape, Analyze, and is pure: the same record
// and options give the same Outcome on any machine.
import type { CallReport } from "@/report/schema";

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
}

/**
 * What one call record turns into. A report always validates under CallReportSchema. no_content is a call with no
 * transcript of any kind (storage stripped, or it never connected). error is a record the engine could not turn
 * into a valid report, with a plain message. Every kind is plain data, safe to store, send or compare.
 */
export type Outcome =
  | { kind: "report"; report: CallReport }
  | { kind: "no_content"; callId: string }
  | { kind: "error"; message: string };

/** The engine's entry point: one raw platform record in, one Outcome out. Never throws. */
export type Analyze = (raw: unknown, opts: EngineOptions) => Outcome;
