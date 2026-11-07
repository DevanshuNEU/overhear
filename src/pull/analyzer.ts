// The analyzer the pull routes pass in: the engine's analyzeRetellCall with this machine's time zone. The engine
// reads no machine settings, so the zone is read here and handed over.
import { analyzeRetellCall } from "@/engine/analyze";
import type { Outcome } from "@/engine/types";

function machineZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function analyzeCall(raw: unknown): Outcome {
  return analyzeRetellCall(raw, { tz: machineZone() });
}
