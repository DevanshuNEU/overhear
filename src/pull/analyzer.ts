// The analyzer the pull routes pass in: the engine's analyzeRetellCall with this machine's time zone and the demo
// agent's id (OVERHEAR_DEMO_AGENT_ID, when set). The engine reads no machine settings, so both are read here and
// handed over. A local user's own agents never get the demo's preset: with the variable unset, no call that carries an
// agent id does.
import { analyzeRetellCall } from "@/engine/analyze";
import type { Outcome } from "@/engine/types";

function machineZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** The demo agent's id from the environment, read at each call; unset or empty is none. */
function demoAgentId(): string | undefined {
  const id = process.env.OVERHEAR_DEMO_AGENT_ID;
  return id ? id : undefined;
}

export function analyzeCall(raw: unknown): Outcome {
  return analyzeRetellCall(raw, { tz: machineZone(), demoAgentId: demoAgentId() });
}
