// The analyzer the pull routes pass in. A placeholder until the engine is wired in.
import type { Outcome } from "@/engine/types";

export function analyzeCall(): Outcome {
  return { kind: "error", callId: null, message: "Not wired yet" };
}
