// Which engine the eval harness runs: analyzeRetellCall. Before it existed the harness ran a stand-in that answered
// every record with an error, so the report showed every case as not passing rather than numbers about an engine
// that did not exist. The stand-in is kept so the report code can still say plainly when it ran one.
import type { Analyze } from "../types";

/** The stand-in: no engine, so no verdict for any record. */
export const engineNotBuiltYet: Analyze = () => ({ kind: "error", callId: null, message: "engine not built yet" });

/** True when the eval would run the stand-in rather than the engine. */
export function isStandIn(analyze: Analyze): boolean {
  return analyze === engineNotBuiltYet;
}

/** How the report names the engine it ran. */
export function engineLabel(analyze: Analyze): string {
  return isStandIn(analyze) ? "stand-in (engine not built yet)" : "analyzeRetellCall";
}

// The engine the eval runs: the real one. The stand-in above stays for the tests that show what a stand-in looks
// like in the report, but nothing exports it as the engine.
export { analyzeRetellCall as engine } from "../analyze";
