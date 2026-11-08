// What every call experience check shares: the check's signature and the runner that builds the report's
// experience from a set of checks. Pure: a check reads the evidence and returns what it found.
import { EXPERIENCE_CHECKS, type Detection, type Evidence, type ExperienceCheckId, type ExperienceProblem } from "@/report/schema";

/** What one check found. ran is false when the call has nothing the check could judge, and problems is then empty. */
export interface ExperienceOutcome {
  ran: boolean;
  problems: ExperienceProblem[];
}

/** What a check gets besides the evidence: the speech detector's output for the call, so no check re-reads a rule the detector owns. */
export interface ExperienceContext {
  detections: Detection[];
}

/** One experience check: the call in, whether it ran and the problems it found out. Problems cite agent turns. */
export type ExperienceCheck = (ev: Evidence, ctx: ExperienceContext) => ExperienceOutcome;

/**
 * Runs each built check in EXPERIENCE_CHECKS order. A check with no entry, or one that could not run, is left out of
 * ran. A check's problems carry its own id.
 */
export function buildExperience(
  checks: Partial<Record<ExperienceCheckId, ExperienceCheck>>,
  ev: Evidence,
  ctx: ExperienceContext,
): { ran: ExperienceCheckId[]; problems: ExperienceProblem[] } {
  const ran: ExperienceCheckId[] = [];
  const problems: ExperienceProblem[] = [];
  for (const id of EXPERIENCE_CHECKS) {
    const outcome = checks[id]?.(ev, ctx);
    if (!outcome?.ran) continue;
    ran.push(id);
    problems.push(...outcome.problems);
  }
  return { ran, problems };
}
