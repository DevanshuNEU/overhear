// The demo clinic's request log keeps each tool call (with the name and date of birth a caller said) for a day, no
// longer. The top-up purges it on every demo call; this timer purges it on its own too, so a quiet day can't keep rows
// past a day. Hosted copies with a database only: local mode and builds never start it.
import { purge } from "./ensure";

/** How often the timer purges: hourly, so no row outlives a day by more than an hour. */
export const RETENTION_EVERY_MS = 60 * 60 * 1000;

/** Starts the hourly purge when this is a hosted copy with a database. Returns a stop function, or null when not started. */
export function startRetention(env: Record<string, string | undefined> = process.env): (() => void) | null {
  if (env.OVERHEAR_LOCAL === "1" || !env.DATABASE_URL) return null;
  const run = async () => {
    try {
      const { db } = await import("@/db/client");
      await purge(db, new Date());
    } catch {
      // Never the error's message: a database error can quote row contents.
      console.warn("retention: could not purge the demo request log");
    }
  };
  void run();
  const timer = setInterval(() => void run(), RETENTION_EVERY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
