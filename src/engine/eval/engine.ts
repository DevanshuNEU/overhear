// Which engine the eval harness runs. Until Task 10 builds analyzeRetellCall, it runs a stand-in that answers
// every record with an error, so the harness works end to end and the report shows every case as not passing,
// rather than numbers about an engine that does not exist.
import type { Analyze } from "../types";

/** The stand-in: no engine yet, so no verdict for any record. */
export const engineNotBuiltYet: Analyze = () => ({ kind: "error", callId: null, message: "engine not built yet" });

/** True when the eval would run the stand-in rather than the engine. */
export function isStandIn(analyze: Analyze): boolean {
  return analyze === engineNotBuiltYet;
}

/** How the report names the engine it ran. */
export function engineLabel(analyze: Analyze): string {
  return isStandIn(analyze) ? "stand-in (engine not built yet)" : "analyzeRetellCall";
}

// The one line Task 10 changes. When src/engine/analyze.ts exists, replace the line below with:
//   export { analyzeRetellCall as engine } from "../analyze";
// Once analyze.ts exists, engine.test.ts fails until this line is swapped. The swap also turns the lock todos in
// locks.test.ts into tests, and the next `npm run eval:engine` reports the real engine.
export { engineNotBuiltYet as engine };
