// Every word the live demo call band says, on the hosted sample list. Real apostrophes, no dashes, sentence case.
// The verdict itself comes from the call row (src/report/labels.ts).

export const DEMO_CALL_WORDS = {
  lead: "Try it on a call of your own.",
  body: "Call our demo clinic agent from your browser. Book an appointment or ask for a nurse, hang up, and see what Overhear finds in your call.",
  firstPatient: (name: string, born: string) => `Call as a test patient: ${name}, born ${born}.`,
  morePatients: "More test patients",
  patientLine: (name: string, born: string) => `${name}, born ${born}`,
  spellName: "The agent will ask you to spell the name.",
  call: "Call the demo agent",
  finePrint: "Uses your microphone. Retell records calls on our demo account. Overhear keeps yours in memory for an hour and shows it only to you.",

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
  ownerSignedIn: "You’re signed in as the owner for 12 hours. Your calls skip the visitor limits.",
  error: "Something went wrong on our side. Try again.",
} as const;

/** A YYYY-MM-DD date in words (August 17, 1991), read as UTC so no time zone shifts the day. */
export function bornInWords(dob: string): string {
  return new Date(`${dob}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The minutes to wait, from the seconds the server says, never less than 1. */
export function busyMinutes(retryAfterSeconds: unknown): number {
  return typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds) ? Math.max(1, Math.ceil(retryAfterSeconds / 60)) : 1;
}

/** Seconds on the call as m:ss. */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
