// The call experience checks, registered. Adding a check is one line in CHECKS; the runner takes them in
// EXPERIENCE_CHECKS order. Experience problems never change the verdict.
import type { Evidence, ExperienceCheckId, ExperienceProblem } from "@/report/schema";
import { buildExperience, type ExperienceCheck } from "./common";
import { agentEndsCall } from "./ends-call";

/** The checks built so far. error_handled and spoken_format have no entry yet, so they are left out of ran. */
const CHECKS: Partial<Record<ExperienceCheckId, ExperienceCheck>> = {
  agent_ends_call: agentEndsCall,
};

/** The report's experience for one call: which checks ran and what they found. */
export function runExperience(ev: Evidence): { ran: ExperienceCheckId[]; problems: ExperienceProblem[] } {
  return buildExperience(CHECKS, ev);
}
