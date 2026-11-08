// The call experience checks, registered. Adding a check is one line in CHECKS; the runner takes them in
// EXPERIENCE_CHECKS order. Experience problems never change the verdict.
import type { Evidence, ExperienceCheckId, ExperienceProblem } from "@/report/schema";
import { buildExperience, type ExperienceCheck, type ExperienceContext } from "./common";
import { agentEndsCall } from "./ends-call";
import { errorHandled } from "./error-handled";
import { spokenFormat } from "./spoken-format";

/** The checks built, one per EXPERIENCE_CHECKS id. A check with no entry is left out of ran. */
const CHECKS: Partial<Record<ExperienceCheckId, ExperienceCheck>> = {
  agent_ends_call: agentEndsCall,
  error_handled: errorHandled,
  spoken_format: spokenFormat,
};

/** The report's experience for one call: which checks ran and what they found. */
export function runExperience(ev: Evidence, ctx: ExperienceContext): { ran: ExperienceCheckId[]; problems: ExperienceProblem[] } {
  return buildExperience(CHECKS, ev, ctx);
}
