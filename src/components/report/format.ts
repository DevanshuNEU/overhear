// Formatting for the call detail screen: clock times and dates. Words live in src/report/labels.ts.
import { RAW_UNAVAILABLE } from "@/report/labels";

/** A time inside the call as minutes and seconds: 142.6 becomes "2:22". */
export function formatClock(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * When the call started, in the report's own timezone so the server and the browser print the same thing.
 * The schema takes any string and number here, so a value that cannot be printed gives null and the fact is left out.
 */
export function formatStarted(ms: number, timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
      timeZoneName: "short",
    }).format(ms);
  } catch {
    return null;
  }
}

/** A raw record as text. A report that holds something JSON cannot write (a BigInt, a loop) still renders. */
export function rawText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw, null, 2) ?? String(raw);
  } catch {
    return RAW_UNAVAILABLE;
  }
}
