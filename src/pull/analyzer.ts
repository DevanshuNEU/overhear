// The analyzer the pull routes pass in: the engine's analyzeRetellCall with this machine's time zone and the demo
// agent's id (OVERHEAR_DEMO_AGENT_ID, else RETELL_AGENT_ID). The engine reads no machine settings, so both are read
// here and handed over. A local user's own agents never get the demo's preset: with neither variable set, no call that
// carries an agent id does.
import { analyzeRetellCall } from "@/engine/analyze";
import type { Outcome } from "@/engine/types";

function machineZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * The demo agent's id from the environment, read at each call: OVERHEAR_DEMO_AGENT_ID if it holds one, else
 * RETELL_AGENT_ID, which holds the provisioned demo agent's id (a user's own local setup leaves it unset). Both are
 * trimmed, and a blank one is none.
 */
function demoAgentId(): string | undefined {
  for (const value of [process.env.OVERHEAR_DEMO_AGENT_ID, process.env.RETELL_AGENT_ID]) {
    const id = value?.trim();
    if (id) return id;
  }
  return undefined;
}

export function analyzeCall(raw: unknown): Outcome {
  return analyzeRetellCall(raw, { tz: machineZone(), demoAgentId: demoAgentId() });
}
