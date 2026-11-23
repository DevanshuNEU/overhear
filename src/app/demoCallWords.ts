// Every word the live demo call band says, on the hosted sample list. Real apostrophes, no dashes, sentence case.
// The verdict itself comes from the call row (src/report/labels.ts).

export const DEMO_CALL_WORDS = {
  lead: "Try it on a call of your own.",
  body: "Call our demo clinic agent from your browser. Book, move or cancel an appointment, hang up, and see what Overhear finds in your call.",
  beforeYouCall: "Before you call",
  clinicZone: "Northwind Family Clinic is in New York. Appointment times are Eastern Time.",
  whatRileyDoes: "Riley can check openings and book, move or cancel an appointment. She can’t give medical advice or transfer calls.",
  doctors: (names: string[]) => `Doctors: ${names.join(", ")}.`,
  firstPatient: (name: string, born: string) => `Call as a test patient: ${name}, born ${born}. Spell it ${spelledName(name)}.`,
  callLimit: "Calls end after 5 minutes. After you hang up, Overhear checks your call in a few seconds.",
  duringCallClinic: (names: string[]) => `Eastern Time. Doctors: ${names.join(", ")}.`,
  morePatients: "More test patients",
  patientLine: (name: string, born: string) => `${name}, born ${born}`,
  spellName: "The agent will ask you to spell the name.",
  duringCall: "Test patients you can call as. The agent will ask you to spell the name.",
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

/** A name spelled the way the agent asks for it: first name letters, then last name letters ("A, I, S, H, A, then R, A, H, M, A, N"). */
export function spelledName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = (w: string) => [...w.replace(/[^\p{L}]/gu, "").toUpperCase()].join(", ");
  const first = parts[0] ?? "";
  const rest = parts.slice(1).join("");
  return rest ? `${letters(first)}, then ${letters(rest)}` : letters(first);
}

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
