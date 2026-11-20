// Every word the live demo call band says, on the hosted sample list. Real apostrophes, no dashes, sentence case.
// The verdict itself comes from the call row (src/report/labels.ts).

export const DEMO_CALL_WORDS = {
  lead: "Try it on a call of your own.",
  body: "Call our demo clinic agent from your browser. Book an appointment, or ask to speak to a nurse: it says it’s transferring you, and it can’t.",
  call: "Call the demo agent",
  finePrint: "Uses your microphone. Calls are recorded on our demo account and shown only to you here.",

  asking: "Allow the microphone to start",
  micBlocked: "Your browser blocked the microphone. Allow it for this site, then try again.",
  tryAgain: "Try again",
  connecting: "Connecting",

  live: "On the call with the demo agent",
  hangUp: "Hang up",
  elapsedLabel: "Time on the call",

  checking: "Checking your call",
  yourCall: "Your call",
  callAgain: "Call again",

  didNotConnect: "The call did not connect, so there is nothing to check.",
  timeout: "Retell has not finished processing your call. Check again in a minute.",
  checkAgain: "Check again",
  busy: (minutes: number) => `The demo is busy. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
  error: "Something went wrong on our side. Try again.",
} as const;

/** The minutes to wait, from the seconds the server says, never less than 1. */
export function busyMinutes(retryAfterSeconds: unknown): number {
  return typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) ? Math.max(1, Math.ceil(retryAfterSeconds / 60)) : 1;
}

/** Seconds on the call as m:ss. */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
