// The demo clinic's time zone and the few conversions that need it. Slots are stored as UTC instants (timestamptz); the
// agent reads clinic time. All of it goes through Intl so daylight saving is handled by the platform's zone data.

export const CLINIC_TZ = "America/New_York";

function parts(date: Date, tz: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** The zone's offset from UTC at an instant, in minutes (Eastern is -300 in winter, -240 in summer). */
export function offsetMinutes(date: Date, tz: string = CLINIC_TZ): number {
  const p = parts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The instant as clinic-local ISO with its offset: 2026-11-23T09:00:00-05:00. */
export function toLocalIso(date: Date, tz: string = CLINIC_TZ): string {
  const p = parts(date, tz);
  const off = offsetMinutes(date, tz);
  const sign = off < 0 ? "-" : "+";
  const abs = Math.abs(off);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The clinic-local calendar date (YYYY-MM-DD) and hour (0 to 23) of an instant. */
export function localDate(date: Date, tz: string = CLINIC_TZ): string {
  const p = parts(date, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
export function localHour(date: Date, tz: string = CLINIC_TZ): number {
  return parts(date, tz).hour;
}
/** Day of week in the zone, 0 = Sunday. */
export function localWeekday(date: Date, tz: string = CLINIC_TZ): number {
  const p = parts(date, tz);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** The instant at which the wall clock in the zone reads this date and hour. */
export function zonedInstant(year: number, month: number, day: number, hour: number, tz: string = CLINIC_TZ): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  // Two passes settle the offset even when the guess lands across a daylight saving change.
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000;
  t = guess - offsetMinutes(new Date(t), tz) * 60000;
  return new Date(t);
}

/** True when the string names a real IANA zone: short, a safe alphabet, and accepted by Intl. */
export function isIanaZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64 || !/^[A-Za-z0-9/_+-]+$/.test(zone)) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
