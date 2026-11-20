// What the two screens that make a call from the browser share: the local test call screen (TestCallScreen) and the demo call
// band on the hosted sample list (DemoCallBand). The microphone comes first on both, the result is polled at the same pace,
// and the buttons look the same.

/** The least time between two asks for a result. A caller's own setting can slow this down, never speed it up. */
export const MIN_POLL_MS = 2000;
export const DEFAULT_POLL_MS = 3000;

export const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-report-line-strong bg-report-surface px-4 text-sm font-semibold enabled:hover:bg-report-calm-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:text-report-ink-2";
export const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-report-accent px-4 text-sm font-semibold text-white enabled:hover:bg-report-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:opacity-70";

/**
 * Asks the browser for the microphone, then lets go of it at once (the call's own client takes it again). "missing" is a
 * browser with no way to ask (no mediaDevices, which is what a page without a secure origin gets); "blocked" is a refusal.
 * Asked before anything that costs a minute, so a blocked microphone starts no call.
 */
export async function requestMicrophone(): Promise<"allowed" | "blocked" | "missing"> {
  const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  if (!devices || typeof devices.getUserMedia !== "function") return "missing";
  try {
    const stream = await devices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return "allowed";
  } catch {
    return "blocked";
  }
}
