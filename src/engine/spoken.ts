// Spoken dates, times and field matching (spec 6.4 and 6.5). The agent says "you're booked for Thursday at 3";
// the system committed 2026-11-05T20:00:00Z. This file reads the words, reads the committed value in the right
// zone, and says whether they agree.
//
// A false "differs" turns into a false "failed", the costliest error the engine can make, so every rule here
// leans one way: when in doubt the answer is "not_spoken" (the contract then says unverified), never "differs".
// "differs" needs all of these: a committed value that reads cleanly, at least one spoken value of the same type
// that resolves, no spoken value that matches, nothing date-like or time-like left in the words that the parser
// did not read, and no redaction placeholder in the words.
//
// Pure: no clock (the call's start is passed in), no machine zone (the zone is passed in), and Intl is always
// given the "en-US" locale. Dates are counted in whole days since 1970-01-01, so day arithmetic never touches a
// zone.
import type { FieldCheck } from "@/report/schema";
import { isPlaceholder } from "./placeholder";

export type FieldType = FieldCheck["type"];

/** One date or time the agent said, resolved against the call's start. */
export interface SpokenDateTime {
  /** YYYY-MM-DD, when the call's start is known (or a year was spoken). */
  date?: string;
  /** MM-DD, when a month and day were spoken but the year can't be known (no call start). */
  monthDay?: string;
  /** HH:MM on a 24-hour clock. With ampm false it is the hour as spoken, 1 to 12. */
  time?: string;
  /** True when the time's half of the day is known: a.m., p.m., noon, midnight, a part of day, or a 24-hour clock. */
  ampm: boolean;
}

export interface MatchContext {
  /** The call's start in epoch ms, or null when the record has none. "Today" and weekdays are counted from it. */
  callStartMs: number | null;
  /** IANA zone the call's date and committed UTC values are read in. */
  tz: string;
  /** True when tz came from the agent's policy, so every committed value is read in it (6.5). */
  policyTz: boolean;
  /** Provider names from lookups in the call. Only these can make a spoken name "differs". */
  otherNames: string[];
}

export type MatchResult = "match" | "differs" | "not_spoken";

// ---------- Calendar arithmetic in whole days ----------

const DAY_MS = 86_400_000;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_TITLES = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_TITLES = WEEKDAYS.map((d) => d[0].toUpperCase() + d.slice(1));

interface Civil {
  y: number;
  m: number; // 1 to 12
  d: number;
}

function daysFromCivil(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

// Howard Hinnant's civil_from_days: whole days since 1970-01-01 to a proleptic Gregorian date.
function civilFromDays(days: number): Civil {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

/** 0 is Sunday. 1970-01-01 was a Thursday. */
function weekdayOf(days: number): number {
  return (((days + 4) % 7) + 7) % 7;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (c: Civil) => `${c.y}-${pad(c.m)}-${pad(c.d)}`;

// ---------- Reading an instant in a zone ----------

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock date and time of an instant in a zone, or null when the zone is not one Intl knows. */
function wallClock(ms: number, tz: string): (Civil & { hh: number; mm: number }) | null {
  try {
    let f = formatters.get(tz);
    if (!f) {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
      formatters.set(tz, f);
    }
    const parts: Record<string, number> = {};
    for (const p of f.formatToParts(ms)) if (p.type !== "literal") parts[p.type] = Number(p.value);
    return { y: parts.year, m: parts.month, d: parts.day, hh: parts.hour % 24, mm: parts.minute };
  } catch {
    return null;
  }
}

/** The call's date in its zone, in days since 1970-01-01, or null when there is no start or the zone is unknown. */
function callDay(callStartMs: number | null, tz: string): number | null {
  if (callStartMs === null || !Number.isFinite(callStartMs)) return null;
  const w = wallClock(callStartMs, tz);
  return w ? daysFromCivil(w.y, w.m, w.d) : null;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_ONLY = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const TIME_12H = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?$/i;
const DATETIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

function validDate(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/**
 * A committed value as wall-clock date and time (6.5). A date-only value, a time-only value and a datetime with
 * no offset are never shifted: they already are wall-clock values. A value ending in Z or +00:00, or any value
 * when the zone is the policy's, is read in tz. A value with a non-zero offset and no policy zone is read in its
 * own offset, which is the date and time as written. Anything unreadable gives {}.
 */
export function toLocal(value: string, tz: string, policyTz: boolean): { date?: string; time?: string } {
  if (typeof value !== "string") return {};
  const v = value.trim();

  let m = DATE_ONLY.exec(v);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDate(y, mo, d) ? { date: ymd({ y, m: mo, d }) } : {};
  }
  m = TIME_ONLY.exec(v);
  if (m) {
    const [hh, mm] = [Number(m[1]), Number(m[2])];
    return hh <= 23 && mm <= 59 ? { time: `${pad(hh)}:${pad(mm)}` } : {};
  }
  m = TIME_12H.exec(v);
  if (m) {
    const [h, mm] = [Number(m[1]), Number(m[2] ?? 0)];
    if (h < 1 || h > 12 || mm > 59) return {};
    const hh = (h % 12) + (m[3].toLowerCase() === "p" ? 12 : 0);
    return { time: `${pad(hh)}:${pad(mm)}` };
  }
  m = DATETIME.exec(v);
  if (!m) return {};
  const [y, mo, d, hh, mm, ss] = [1, 2, 3, 4, 5, 6].map((i) => Number(m![i] ?? 0));
  if (!validDate(y, mo, d) || hh > 23 || mm > 59 || ss > 59) return {};
  const asWritten = { date: ymd({ y, m: mo, d }), time: `${pad(hh)}:${pad(mm)}` };
  const zone = m[7];
  if (zone === undefined) return asWritten;
  const offsetMin = zone.toUpperCase() === "Z" ? 0 : offsetMinutes(zone);
  if (offsetMin !== 0 && !policyTz) return asWritten;
  const w = wallClock(Date.UTC(y, mo - 1, d, hh, mm, ss) - offsetMin * 60_000, tz);
  return w ? { date: ymd(w), time: `${pad(w.hh)}:${pad(w.mm)}` } : {};
}

function offsetMinutes(zone: string): number {
  const digits = zone.replace(":", "");
  const sign = digits[0] === "-" ? -1 : 1;
  return sign * (Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5)));
}

// ---------- Words ----------

const HOUR_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const UNITS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS: [string, number][] = [["twenty", 20], ["thirty", 30], ["forty", 40], ["fifty", 50]];

const MINUTE_WORDS: Record<string, number> = {};
UNITS.forEach((u, i) => (MINUTE_WORDS[`oh ${u}`] = i + 1));
TEENS.forEach((t, i) => (MINUTE_WORDS[t] = 10 + i));
for (const [t, n] of TENS) {
  MINUTE_WORDS[t] = n;
  UNITS.forEach((u, i) => (MINUTE_WORDS[`${t} ${u}`] = n + i + 1));
}

const ORDINAL_UNITS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"];
const ORDINAL_WORDS: Record<string, number> = {};
ORDINAL_UNITS.forEach((o, i) => (ORDINAL_WORDS[o] = i + 1));
["tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth"].forEach(
  (o, i) => (ORDINAL_WORDS[o] = 10 + i),
);
ORDINAL_WORDS.twentieth = 20;
ORDINAL_UNITS.forEach((o, i) => (ORDINAL_WORDS[`twenty ${o}`] = 21 + i));
ORDINAL_WORDS.thirtieth = 30;
ORDINAL_WORDS["thirty first"] = 31;

/** A regex alternation of phrases, longest first, where a space in a phrase also accepts a hyphen. */
function alternation(words: string[]): string {
  return [...words].sort((a, b) => b.length - a.length).map((w) => w.replace(/ /g, "[\\s-]+")).join("|");
}

/** A matched phrase as its table key: lowercase, single spaces. */
const key = (s: string) => s.toLowerCase().replace(/[\s-]+/g, " ");

const WD = `(${WEEKDAYS.join("|")})`;
const MON = `(${MONTHS.join("|")}|sept)`;
const ORD = `(${alternation(Object.keys(ORDINAL_WORDS))})`;
const HOURW = `(${alternation(Object.keys(HOUR_WORDS))})`;
const MINW = `(${alternation(Object.keys(MINUTE_WORDS))})`;
const END = "(?![a-z0-9])";
// A digit day, with or without an ordinal suffix, never the hour of a time.
const DIGIT_DAY = "(\\d{1,2})(st|nd|rd|th)?(?!\\d|:\\d|\\s*(?:[ap]\\.?\\s?m(?![a-z])|o['’]?\\s?clock))";

const sticky = (src: string) => new RegExp(src, "iy");

const RE = {
  relative: sticky(`(the\\s+day\\s+after\\s+tomorrow|tomorrow|today|tonight)${END}`),
  weekday: sticky(`(?:(next|this\\s+coming|this|coming)\\s+)?${WD}${END}`),
  weekdayRange: sticky(`\\s*(?:-|to|through|thru|until|till)\\s+(?:next\\s+)?${WD}${END}`),
  // After a weekday: ", the 5th", " the fifth of November", ", November 6".
  afterWeekdayDay: sticky(`,?\\s*(?:the\\s+)?(?:(\\d{1,2})(st|nd|rd|th)|${ORD})${END}(?:\\s+of\\s+${MON}${END})?`),
  afterWeekdayMonth: sticky(`,?\\s*${MON}\\.?\\s+(?:the\\s+)?(?:${DIGIT_DAY}|${ORD})${END}`),
  monthDay: sticky(`${MON}\\.?\\s+(?:the\\s+)?(?:${DIGIT_DAY}|${ORD})${END}`),
  theDay: sticky(`the\\s+(?:(\\d{1,2})(st|nd|rd|th)|${ORD})${END}(?:\\s+of\\s+${MON}${END})?`),
  dayOfMonth: sticky(`(?:(\\d{1,2})(st|nd|rd|th)?|${ORD})\\s+of\\s+${MON}${END}`),
  year: sticky(`,?\\s*((?:19|20)\\d{2})(?![\\d:])`),
  prefix: sticky(`(at|around|about|by|for|from|to|until|till|before|after)\\s+`),
  noon: sticky(`(?:12\\s+)?(noon|midday|midnight)${END}`),
  quarter: sticky(
    `(half\\s+past|quarter\\s+past|quarter\\s+after|quarter\\s+to|quarter\\s+of|${MINW}\\s+(?:minutes\\s+)?(?:past|after|to|before))\\s+(?:(\\d{1,2})(?![\\d:])|${HOURW}${END})`,
  ),
  colon: sticky(`(\\d{1,2}):(\\d{2})(?!\\d)`),
  hourMinuteWords: sticky(`(?:(\\d{1,2})|${HOURW})\\s+${MINW}${END}`),
  oclock: sticky(`(?:(\\d{1,2})|${HOURW})\\s+o['’]?\\s?clock${END}`),
  hour: sticky(`(?:(\\d{1,2})(?!\\d|[:.,]\\d|%|(?:st|nd|rd|th)${END})|${HOURW}${END})`),
  ampm: sticky(`\\s*(?:([ap])\\.\\s?m(?![a-z])\\.?|([ap])m(?![a-z]))`),
  partOfDay: sticky(`,?\\s+(in\\s+the\\s+(?:morning|afternoon|evening)|at\\s+night|tonight|this\\s+(?:morning|afternoon|evening))${END}`),
};

// Words before "today", "tomorrow" or "tonight" that make it the date of a booking rather than small talk
// ("anything else I can help you with today?"). Next to a spoken time it counts anyway.
const RELATIVE_CONTEXT = /\b(?:for|on|until|till|from|to|is|are|was|be|booked|scheduled|set|moved|it['’]s|that['’]s|starting|by)\s+$/i;
// "every Thursday" or "most Mondays" is opening hours, not a booking.
const RECURRING = /\b(?:every|each|most|some)\s+$/i;
// "a week from Thursday", "two days after Monday", "Thursday after next", "Thursday week": a weekday shifted by
// words the parser does not count. Left unread, so the field can't differ on it.
const SHIFTED_BEFORE = /\b(?:weeks?|days?|fortnight)\s+(?:from|after|before)\s+(?:this\s+|next\s+)?$/i;
const SHIFTED_AFTER = /^\s+(?:after\s+next|week\b|fortnight\b)/i;
// "Monday to Friday" is a range of opening days, unless the sentence moves something ("moved you from Wednesday
// to Thursday"), where the two weekdays are two dates.
const CHANGE_WORDS = /\b(?:mov|chang|switch|reschedul|push|bump|shift)\w*/i;
// What follows a number that makes it something other than an hour: a capitalized word that is not a weekday or
// month ("at 5 Elm Street"), or a unit or place word ("at 2 locations").
const NOT_AN_HOUR_AFTER = new RegExp(
  `^\\s+(?:(?!(?:${WEEKDAY_TITLES.join("|")}|${MONTH_TITLES.join("|")})(?![a-z]))\\p{Lu}|(?:locations?|offices?|clinics?|people|patients|providers?|doctors?|minutes?|hours?|days?|weeks?|months?|years?|floor|suite|room|street|st|avenue|ave|road|rd|blvd|percent)\\b)`,
  "u",
);

// What is left after the parser: anything here means a date or time was said that it did not read, so a
// "differs" would rest on half the words.
const DATE_LEFTOVER = new RegExp(
  [
    "\\d",
    `\\b(?:${WEEKDAYS.join("|")})s?\\b`,
    "\\b(?:tues|thur|thurs)\\b",
    `\\b(?:${MONTHS.filter((m) => m !== "may").join("|")}|sept)\\b`,
    "\\b(?:tomorrow|tonight|yesterday|weekend|week|month)\\b",
    `\\bthe\\s+(?:${ORD})\\b`,
    `\\b(?:${ORD})\\s+of\\b`,
  ].join("|"),
  "i",
);
const TIME_LEFTOVER = new RegExp(
  [
    "\\d",
    "\\b(?:noon|midday|midnight|tonight)\\b",
    "o['’]?\\s?clock",
    "\\b[ap]\\.\\s?m\\b",
    "\\bhalf\\s+past\\b",
    "\\bquarter\\s+(?:past|after|to|of)\\b",
    "\\b(?:in\\s+the|this|tomorrow)\\s+(?:morning|afternoon|evening)\\b",
    "\\bat\\s+night\\b",
    // A time said in a named zone may not be the zone the committed value is read in.
    "\\b(?:est|edt|cst|cdt|mst|mdt|pst|pdt|utc|gmt|eastern|central|mountain|pacific)\\b",
    `\\b(?:at|around|until|till|from|between)\\s+(?:${HOURW})\\b`,
    `\\b(?:${HOURW})\\s+(?:minutes\\s+)?(?:to|past|after)\\s+(?:${HOURW})\\b`,
    `\\b(?:${HOURW})[\\s-]+(?:oh|ten|fifteen|twenty|thirty|forty|fifty)\\b`,
  ].join("|"),
  "i",
);

// ---------- Spoken mentions ----------

interface DateMention {
  start: number;
  end: number;
  weekday?: number;
  next?: boolean;
  day?: number;
  month?: number;
  year?: number;
  relative?: number;
  tonight?: boolean;
  /** A relative word with no booking words before it; kept only next to a spoken time. */
  weak?: boolean;
}

interface TimeMention {
  start: number; // after any "at"
  spanStart: number; // including it
  end: number;
  hh: number;
  mm: number;
  ampm: boolean;
}

interface Entry {
  date?: DateMention;
  time?: TimeMention;
}

interface Scan {
  entries: Entry[];
  dateIncomplete: boolean;
  timeIncomplete: boolean;
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

function at(re: RegExp, text: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(text);
}

const monthOf = (word: string | undefined) => {
  if (!word) return undefined;
  const w = word.toLowerCase();
  return w === "sept" ? 9 : MONTHS.indexOf(w) + 1;
};
const ordinalOf = (word: string | undefined) => (word ? ORDINAL_WORDS[key(word)] : undefined);

/** A day number that can be a calendar day, given the month when one was spoken. */
function plausibleDay(day: number | undefined, month: number | undefined, year: number | undefined): boolean {
  if (day === undefined || day < 1 || day > 31) return false;
  return month === undefined || day <= daysInMonth(year ?? 2024, month);
}

type DateHit = { kind: "mention"; mention: DateMention } | { kind: "skip"; end: number };

function readYear(text: string, i: number, mention: DateMention): void {
  const y = at(RE.year, text, i);
  if (y) {
    mention.year = Number(y[1]);
    mention.end = i + y[0].length;
  }
}

function matchDate(text: string, i: number): DateHit | null {
  const before = text.slice(0, i);

  let m = at(RE.relative, text, i);
  if (m) {
    const word = key(m[1]);
    const mention: DateMention = {
      start: i,
      end: i + m[0].length,
      relative: word === "tomorrow" ? 1 : word.startsWith("the day after") ? 2 : 0,
      tonight: word === "tonight",
      weak: !RELATIVE_CONTEXT.test(before),
    };
    return { kind: "mention", mention };
  }

  m = at(RE.weekday, text, i);
  if (m) {
    const end = i + m[0].length;
    if (RECURRING.test(before) || SHIFTED_BEFORE.test(before) || SHIFTED_AFTER.test(text.slice(end))) return { kind: "skip", end };
    const range = at(RE.weekdayRange, text, end);
    const sentence = before.slice(Math.max(before.lastIndexOf(". "), before.lastIndexOf("? "), before.lastIndexOf("! "), 0));
    if (range && !(/^\s*(?:to|until|till)\b/i.test(range[0]) && CHANGE_WORDS.test(sentence))) {
      return { kind: "skip", end: end + range[0].length };
    }
    const mention: DateMention = { start: i, end, weekday: WEEKDAYS.indexOf(m[2].toLowerCase()), next: m[1]?.toLowerCase() === "next" };
    const dm = at(RE.afterWeekdayMonth, text, end);
    const dd = dm ? null : at(RE.afterWeekdayDay, text, end);
    if (dm) {
      const month = monthOf(dm[1]);
      const day = dm[2] ? Number(dm[2]) : ordinalOf(dm[4]);
      if (plausibleDay(day, month, undefined)) Object.assign(mention, { month, day, end: end + dm[0].length });
    } else if (dd) {
      const month = monthOf(dd[4]);
      const day = dd[1] ? Number(dd[1]) : ordinalOf(dd[3]);
      if (plausibleDay(day, month, undefined)) Object.assign(mention, { month, day, end: end + dd[0].length });
    }
    if (mention.day !== undefined) readYear(text, mention.end, mention);
    return { kind: "mention", mention };
  }

  m = at(RE.monthDay, text, i);
  if (m) {
    const month = monthOf(m[1]);
    const day = m[2] ? Number(m[2]) : ordinalOf(m[4]);
    if (!plausibleDay(day, month, undefined)) return null;
    const mention: DateMention = { start: i, end: i + m[0].length, month, day };
    readYear(text, mention.end, mention);
    return { kind: "mention", mention };
  }

  m = at(RE.theDay, text, i);
  if (m) {
    const month = monthOf(m[4]);
    const day = m[1] ? Number(m[1]) : ordinalOf(m[3]);
    const end = i + m[0].length;
    // "the first available", "the second option": an ordinal word is a date only with a month, or at the end
    // of a clause, or before a time or a name.
    if (!m[1] && month === undefined && !/^(?:\s*$|\s*[.,;:!?]|\s+(?:at|with|instead|then|or|and)\b)/i.test(text.slice(end))) return null;
    if (!plausibleDay(day, month, undefined)) return null;
    const mention: DateMention = { start: i, end, month, day };
    readYear(text, end, mention);
    return { kind: "mention", mention };
  }

  m = at(RE.dayOfMonth, text, i);
  if (m) {
    const month = monthOf(m[4]);
    const day = m[1] ? Number(m[1]) : ordinalOf(m[3]);
    if (!plausibleDay(day, month, undefined)) return null;
    const mention: DateMention = { start: i, end: i + m[0].length, month, day };
    readYear(text, mention.end, mention);
    return { kind: "mention", mention };
  }
  return null;
}

const hourOf = (digits: string | undefined, word: string | undefined) => (digits !== undefined ? Number(digits) : HOUR_WORDS[key(word ?? "")]);

/** A clock time starting at i (after any "at"), or null. Applies a.m., p.m. and parts of day. */
function matchTime(text: string, i: number, prefix: string | null): TimeMention | null {
  let h: number;
  let mm = 0;
  let end: number;
  let kind: "fixed" | "clock" | "words" | "hour";

  let m = at(RE.noon, text, i);
  if (m) {
    const midnight = m[1].toLowerCase() === "midnight";
    return { start: i, spanStart: i, end: i + m[0].length, hh: midnight ? 0 : 12, mm: 0, ampm: true };
  }
  if ((m = at(RE.quarter, text, i))) {
    const phrase = key(m[1]);
    const target = hourOf(m[3], m[4]);
    const minutes = phrase.startsWith("half") ? 30 : phrase.startsWith("quarter") ? 15 : MINUTE_WORDS[key(m[2] ?? "")];
    const before = /\b(?:to|of|before)$/.test(phrase);
    if (!target || target > 12 || !minutes || minutes >= 60) return null;
    // "ten to five" is as likely a range of hours ("open from ten to five") as 4:50; only "ten minutes to five" is sure.
    if (!/^(?:half|quarter)/.test(phrase) && minutes <= 12 && !/\bminutes\b/.test(phrase)) return null;
    h = before ? (target === 1 ? 12 : target - 1) : target;
    mm = before ? 60 - minutes : minutes;
    end = i + m[0].length;
    kind = "words";
  } else if ((m = at(RE.colon, text, i))) {
    h = Number(m[1]);
    mm = Number(m[2]);
    if (h > 23 || mm > 59) return null;
    end = i + m[0].length;
    kind = "clock";
  } else if ((m = at(RE.oclock, text, i))) {
    h = hourOf(m[1], m[2]);
    end = i + m[0].length;
    kind = "words";
  } else if ((m = at(RE.hourMinuteWords, text, i))) {
    h = hourOf(m[1], m[2]);
    mm = MINUTE_WORDS[key(m[3])];
    end = i + m[0].length;
    kind = "hour"; // "three thirty" needs an "at" or a.m./p.m. like a bare hour
  } else if ((m = at(RE.hour, text, i))) {
    h = hourOf(m[1], m[2]);
    end = i + m[0].length;
    kind = "hour";
  } else {
    return null;
  }

  let ampm = false;
  const ap = at(RE.ampm, text, end);
  const part = ap ? null : at(RE.partOfDay, text, end);
  if (ap) {
    const pm = (ap[1] ?? ap[2]).toLowerCase() === "p";
    if (h >= 1 && h <= 12) h = (h % 12) + (pm ? 12 : 0);
    else if (!(h > 12 && pm)) return null; // "15:30 a.m." or "0 p.m." is not a time
    ampm = true;
    end += ap[0].length;
  } else if (part) {
    const p = key(part[1]);
    if (h >= 1 && h <= 12) {
      if (p.endsWith("morning")) h = h % 12;
      else if (h === 12 && (p === "at night" || p === "tonight")) h = 0;
      else if (h !== 12) h += 12;
      ampm = true;
      end += part[0].length;
    }
  } else if (kind === "hour") {
    // A bare number is a time only after "at" or "around" ("Thursday at 3"); "three thirty" also after "to" or "by".
    if (mm === 0 && prefix !== "at" && prefix !== "around") return null;
    if (mm > 0 && !prefix) return null;
    // Not an address or a count: "at 5 Elm Street", "at 2 locations".
    if (NOT_AN_HOUR_AFTER.test(text.slice(end))) return null;
  }
  if (kind === "clock" && !ampm && (h === 0 || h > 12)) ampm = true; // a 24-hour clock says its half of the day
  if (!(h >= 0 && h <= 23) || (kind !== "clock" && !ampm && (h < 1 || h > 12))) return null;
  return { start: i, spanStart: i, end, hh: h, mm, ampm };
}

/** Every date and time in the words, paired when they sit together, plus whether anything was left unread. */
function scan(text: string): Scan {
  const dates: DateMention[] = [];
  const times: TimeMention[] = [];
  const skipped: [number, number][] = [];
  let i = 0;
  while (i < text.length) {
    if (!isWordChar(text[i]) || isWordChar(text[i - 1])) {
      i++;
      continue;
    }
    const d = matchDate(text, i);
    if (d?.kind === "mention") {
      dates.push(d.mention);
      i = d.mention.end;
      continue;
    }
    if (d?.kind === "skip") {
      skipped.push([i, d.end]);
      i = d.end;
      continue;
    }
    const p = at(RE.prefix, text, i);
    const t = (p && matchTime(text, i + p[0].length, p[1].toLowerCase())) || matchTime(text, i, null);
    if (t) {
      times.push({ ...t, spanStart: i });
      i = t.end;
      continue;
    }
    i++;
  }

  // Pair a date with the time right after it ("Thursday at 3") or right before it ("at 3 on Thursday").
  const all = [...dates.map((date) => ({ at: date.start, date })), ...times.map((time) => ({ at: time.spanStart, time }))].sort((a, b) => a.at - b.at);
  const entries: Entry[] = [];
  for (let k = 0; k < all.length; k++) {
    const cur = all[k];
    const nxt = all[k + 1];
    if (nxt && "date" in cur && "time" in nxt && /^[\s,]*$/.test(text.slice(cur.date!.end, nxt.time!.spanStart))) {
      entries.push({ date: cur.date, time: nxt.time });
      k++;
    } else if (nxt && "time" in cur && "date" in nxt && /^[\s,]*(?:on)?[\s,]*$/i.test(text.slice(cur.time!.end, nxt.date!.start))) {
      entries.push({ date: nxt.date, time: cur.time });
      k++;
    } else {
      entries.push("date" in cur ? { date: cur.date } : { time: cur.time });
    }
  }

  // Small-talk "today" drops out; "tonight at 7" is 7 p.m.
  const kept = entries.filter((e) => !(e.date?.weak && !e.time));
  for (const e of kept) {
    if (e.date?.tonight && e.time && !e.time.ampm && e.time.hh < 12) e.time = { ...e.time, hh: e.time.hh + 12, ampm: true };
  }

  const blanked = text.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) blanked[k] = " ";
  };
  for (const e of kept) {
    if (e.date) blank(e.date.start, e.date.end);
    if (e.time) blank(e.time.spanStart, e.time.end);
  }
  // A small-talk "today" says nothing about the booking; a stray "tomorrow" or "tonight" stays as a leftover.
  for (const e of entries) if (e.date?.weak && !e.time && e.date.relative === 0 && !e.date.tonight) blank(e.date.start, e.date.end);
  const leftover = blanked.join("");
  const scrubbed = isPlaceholder(text);
  return {
    entries: kept,
    dateIncomplete: scrubbed || DATE_LEFTOVER.test(leftover),
    timeIncomplete: scrubbed || TIME_LEFTOVER.test(leftover),
  };
}

// ---------- Resolving a spoken date ----------

interface DateReading {
  /** The single date the words most likely mean, for display and for parseSpokenDateTimes. */
  primary: number | null;
  monthDay: string | null;
  /** False when the words can't be pinned to the calendar (a relative date with no call start). */
  comparable: boolean;
  /** Whether a committed date (in days) is one the words can mean. Leans to yes when the words allow two readings. */
  allows: (day: number) => boolean;
}

/** The next date on or after `from` with this day of the month, at most a year ahead. */
function rollForward(from: number, day: number): number | null {
  let { y, m } = civilFromDays(from);
  for (let k = 0; k < 13; k++) {
    if (day <= daysInMonth(y, m)) {
      const candidate = daysFromCivil(y, m, day);
      if (candidate >= from) return candidate;
    }
    m = m === 12 ? 1 : m + 1;
    if (m === 1) y++;
  }
  return null;
}

/** The dates a bare or "next" weekday can mean, counted from the call date. */
function weekdayDates(today: number, weekday: number, next: boolean): { primary: number; all: number[] } {
  const ahead = (weekday - weekdayOf(today) + 7) % 7;
  if (!next) {
    // "A bare weekday is the next one after the call date"; said on that same weekday it may mean today.
    const primary = today + (ahead === 0 ? 7 : ahead);
    return { primary, all: ahead === 0 ? [today, primary] : [primary] };
  }
  // "next Tuesday" is the Tuesday of the following week (weeks start on Monday). People also use it for the
  // nearest Tuesday, so every Tuesday in the next 13 days is allowed.
  const nextMonday = today - ((weekdayOf(today) + 6) % 7) + 7;
  const primary = nextMonday + ((weekday + 6) % 7);
  const all = [1, 2].map((n) => today + (ahead === 0 ? 7 * n : ahead + 7 * (n - 1))).filter((d) => d <= today + 13);
  return { primary, all };
}

function readDate(m: DateMention, today: number | null): DateReading {
  if (m.relative !== undefined) {
    if (today === null) return { primary: null, monthDay: null, comparable: false, allows: () => false };
    const primary = today + m.relative;
    return { primary, monthDay: null, comparable: true, allows: (d) => d === primary };
  }

  if (m.day === undefined) {
    // A weekday alone.
    const weekday = m.weekday!;
    if (today === null) return { primary: null, monthDay: null, comparable: true, allows: (d) => weekdayOf(d) === weekday };
    const { primary, all } = weekdayDates(today, weekday, m.next ?? false);
    return { primary, monthDay: null, comparable: true, allows: (d) => all.includes(d) || d === primary };
  }

  const { day, month, year } = m;
  let primary: number | null = null;
  if (year !== undefined && month !== undefined) {
    primary = validDate(year, month, day) ? daysFromCivil(year, month, day) : null;
  } else if (today !== null) {
    const now = civilFromDays(today);
    if (month !== undefined) {
      const y = daysFromCivil(now.y, month, Math.min(day, daysInMonth(now.y, month))) < today ? now.y + 1 : now.y;
      primary = validDate(y, month, day) ? daysFromCivil(y, month, day) : null;
    } else {
      primary = rollForward(today, day);
    }
  }
  const monthDay = month !== undefined ? `${pad(month)}-${pad(day)}` : null;
  // Only what was said is compared: "the 24th" is the 24th of any month, "November 5th" any year's.
  const spokenParts = (d: number) => {
    const c = civilFromDays(d);
    return c.d === day && (month === undefined || c.m === month) && (year === undefined || c.y === year);
  };
  // A weekday that disagrees with the day number ("Friday the 5th" when the 5th is a Thursday): either reading.
  const weekday = m.weekday;
  const consistent = weekday === undefined || (primary !== null && weekdayOf(primary) === weekday);
  let weekdayReading: (d: number) => boolean = () => false;
  if (!consistent && weekday !== undefined) {
    if (today === null) weekdayReading = (d) => weekdayOf(d) === weekday;
    else {
      const { primary: p, all } = weekdayDates(today, weekday, m.next ?? false);
      weekdayReading = (d) => all.includes(d) || d === p;
    }
  }
  return { primary, monthDay, comparable: true, allows: (d) => spokenParts(d) || weekdayReading(d) };
}

// ---------- Public: parsing ----------

/**
 * Every date or time the words mention, in order, with a date and a time that sit together ("Thursday at 3") as
 * one value. With no call start there is no year: a spoken month and day comes back as monthDay, and relative
 * dates ("tomorrow", "Thursday") are skipped. Where the words allow two readings this gives the likelier one;
 * matchField accepts either.
 */
export function parseSpokenDateTimes(text: string, callStartMs: number | null, tz: string): SpokenDateTime[] {
  const today = callDay(callStartMs, tz);
  const out: SpokenDateTime[] = [];
  for (const e of scan(text).entries) {
    const v: SpokenDateTime = { ampm: false };
    if (e.date) {
      const r = readDate(e.date, today);
      if (r.primary !== null) v.date = ymd(civilFromDays(r.primary));
      else if (r.monthDay !== null) v.monthDay = r.monthDay;
    }
    if (e.time) {
      v.time = `${pad(e.time.hh)}:${pad(e.time.mm)}`;
      v.ampm = e.time.ampm;
    }
    if (v.date || v.monthDay || v.time) out.push(Object.fromEntries(Object.entries(v).sort(([a], [b]) => order(a) - order(b))) as SpokenDateTime);
  }
  return out;
}

const order = (k: string) => ["date", "monthDay", "time", "ampm"].indexOf(k);

// ---------- Public: matching ----------

type Compared = "match" | "differs" | "none";

function compareDate(s: Scan, committed: string, today: number | null): Compared {
  const [y, m, d] = committed.split("-").map(Number);
  const target = daysFromCivil(y, m, d);
  const readings = s.entries.filter((e) => e.date).map((e) => readDate(e.date!, today));
  if (readings.some((r) => r.comparable && r.allows(target))) return "match";
  const incomplete = s.dateIncomplete || readings.some((r) => !r.comparable);
  return readings.some((r) => r.comparable) && !incomplete ? "differs" : "none";
}

function compareTime(s: Scan, committed: string): Compared {
  const [ch, cm] = committed.split(":").map(Number);
  const times = s.entries.flatMap((e) => (e.time ? [e.time] : []));
  // A time said without a.m. or p.m. matches the committed hour modulo 12.
  if (times.some((t) => t.mm === cm && (t.ampm ? t.hh === ch : t.hh % 12 === ch % 12))) return "match";
  return times.length > 0 && !s.timeIncomplete ? "differs" : "none";
}

function matchDateTime(type: "date" | "time" | "datetime", text: string, committed: unknown, ctx: MatchContext): MatchResult {
  if (typeof committed !== "string") return "not_spoken";
  const local = toLocal(committed, ctx.tz, ctx.policyTz);
  const needDate = type !== "time";
  const needTime = type !== "date";
  if ((needDate && !local.date) || (needTime && !local.time)) return "not_spoken";
  const s = scan(text);
  const date = needDate ? compareDate(s, local.date!, callDay(ctx.callStartMs, ctx.tz)) : "match";
  const time = needTime ? compareTime(s, local.time!) : "match";
  if (date === "differs" || time === "differs") return "differs";
  if (date === "match" && time === "match") return "match";
  return "not_spoken";
}

const TITLES = /^(?:dr|doctor|mr|mrs|ms|miss|mx|prof|professor|nurse)\.?\s+/i;
const SUFFIXES = new Set(["md", "do", "rn", "np", "pa", "phd", "jr", "sr", "ii", "iii"]);
const TITLE_WORDS = "(?:dr|doctor|mr|mrs|ms|miss|mx|prof|professor|nurse)\\.?";

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** First name and surname of a name, without titles or letters after it. Null when there is no surname. */
function nameParts(name: string): { first?: string; last: string } | null {
  let n = name.split(",")[0].trim();
  while (TITLES.test(n)) n = n.replace(TITLES, "");
  const tokens = n.split(/\s+/).map((t) => t.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")).filter((t) => t && !SUFFIXES.has(t.toLowerCase()));
  const last = tokens.at(-1);
  if (!last || last.length < 2) return null;
  return { first: tokens.length >= 2 ? tokens[0] : undefined, last };
}

function findWord(text: string, word: string): string | null {
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, "iu").exec(text);
  return m ? m[0] : null;
}

/** A name in the words, said as a title and surname or a first name and surname: "Dr. Okafor", "James Okafor". */
function findFullName(text: string, parts: { first?: string; last: string }): string | null {
  const forms = [`${TITLE_WORDS}\\s+(?:${parts.first ? `${escape(parts.first)}\\s+` : ""})?${escape(parts.last)}`];
  if (parts.first) forms.push(`${escape(parts.first)}\\s+${escape(parts.last)}`);
  const m = new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.join("|")})(?![\\p{L}\\p{N}])`, "iu").exec(text);
  return m ? m[0] : null;
}

function matchName(text: string, committed: unknown, ctx: MatchContext): { status: MatchResult; said: string | null } {
  if (typeof committed !== "string") return { status: "not_spoken", said: null };
  const parts = nameParts(committed);
  if (!parts) return { status: "not_spoken", said: null };
  const surname = findWord(text, parts.last);
  if (surname) return { status: "match", said: findFullName(text, parts) ?? surname };
  const first = parts.first ? findWord(text, parts.first) : null;
  // A different provider counts only when said with a title or first name, so "you may" is never Dr. May. With
  // the committed first name also said, or a scrubbed name, the words are ambiguous and never differ.
  for (const other of ctx.otherNames) {
    const o = typeof other === "string" ? nameParts(other) : null;
    if (!o || o.last.toLowerCase() === parts.last.toLowerCase()) continue;
    const said = findFullName(text, o);
    if (said) return { status: first || isPlaceholder(text) ? "not_spoken" : "differs", said };
  }
  return first ? { status: "match", said: first } : { status: "not_spoken", said: null };
}

function matchId(text: string, committed: unknown): string | null {
  if (typeof committed !== "string" && typeof committed !== "number") return null;
  const id = String(committed).trim();
  if (!id) return null;
  const forms = [escape(id)];
  // Spelled out: "A B 1 2" or "A-B-1-2".
  if (id.length >= 3 && /^[\p{L}\p{N}]+$/u.test(id)) forms.push([...id].map(escape).join("[\\s.-]*"));
  const m = new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms.join("|")})(?![\\p{L}\\p{N}])`, "iu").exec(text);
  return m ? m[0] : null;
}

const normalizeWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function matchString(text: string, committed: unknown): string | null {
  if (typeof committed !== "string" && typeof committed !== "number" && typeof committed !== "boolean") return null;
  const want = normalizeWords(String(committed));
  if (!want) return null;
  return ` ${normalizeWords(text)} `.includes(` ${want} `) ? String(committed) : null;
}

const SMALL_NUMBERS: Record<string, number> = { zero: 0, ...HOUR_WORDS, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };

/** A committed number or amount, from 25, "25", "25.00", "$1,250" or "25 USD". Null when it is not one. */
function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const s = value.trim().replace(/^\$\s*/, "").replace(/\s*(?:usd|dollars?)$/i, "").replace(/,(?=\d{3}\b)/g, "");
  return /^-?\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
}

function matchNumber(text: string, committed: unknown): string | null {
  const want = numberOf(committed);
  if (want === null) return null;
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    if (Math.abs(Number(m[0].replace(/,/g, "")) - want) < 1e-9) return m[0];
  }
  for (const m of text.matchAll(/\p{L}+/gu)) {
    if (SMALL_NUMBERS[m[0].toLowerCase()] === want) return m[0];
  }
  return null;
}

/**
 * Whether the words state the committed value (6.4, 6.5). "match" when any spoken value of the type matches;
 * "differs" only when values of the type were spoken, every date or time-like word was read, nothing is
 * scrubbed, and none matches; else "not_spoken". A committed value that is missing, a placeholder or unreadable
 * gives "not_spoken" here; fieldCheck reports it as unresolved. Names match on the surname, without titles, and
 * differ only when another provider from the call is named. string, number, money and id never differ in M1.
 */
export function matchField(type: FieldType, text: string, committed: unknown, ctx: MatchContext): MatchResult {
  if (committed === null || committed === undefined || isPlaceholder(committed)) return "not_spoken";
  switch (type) {
    case "date":
    case "time":
    case "datetime":
      return matchDateTime(type, text, committed, ctx);
    case "name":
      return matchName(text, committed, ctx).status;
    case "id":
      return matchId(text, committed) ? "match" : "not_spoken";
    case "string":
      return matchString(text, committed) ? "match" : "not_spoken";
    case "number":
    case "money":
      return matchNumber(text, committed) ? "match" : "not_spoken";
  }
}

// ---------- Public: display ----------

const NAME_IN_TEXT = /(?<![\p{L}\p{N}])(?:Dr|Doctor|Mr|Mrs|Ms|Miss|Mx|Prof|Professor|Nurse)\.?\s+\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)?/gu;
const CALENDAR_WORDS = new Set([...WEEKDAYS, ...MONTHS]);

/**
 * The values of a type as the agent said them, in order, for a finding's {spoken} and a field row. Dates and
 * times come from the parser; names are titled names ("Dr. Nair") and the call's provider names found in the
 * words. Other types have no general reading and give [].
 */
export function spokenValues(type: FieldType, text: string, ctx: MatchContext): string[] {
  const out: string[] = [];
  const add = (v: string) => {
    const t = v.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  if (type === "date" || type === "time" || type === "datetime") {
    for (const e of scan(text).entries) {
      if (type === "date" && e.date) add(text.slice(e.date.start, e.date.end));
      if (type === "time" && e.time) add(text.slice(e.time.start, e.time.end));
      if (type === "datetime") {
        const start = Math.min(e.date?.start ?? Infinity, e.time?.start ?? Infinity);
        const end = Math.max(e.date?.end ?? -1, e.time?.end ?? -1);
        add(text.slice(start, end));
      }
    }
  } else if (type === "name") {
    for (const m of text.matchAll(NAME_IN_TEXT)) {
      const words = m[0].replace(/['’]s$/, "").split(/\s+/);
      add((CALENDAR_WORDS.has(words.at(-1)!.toLowerCase()) && words.length > 2 ? words.slice(0, -1) : words).join(" "));
    }
    for (const other of ctx.otherNames) {
      const parts = typeof other === "string" ? nameParts(other) : null;
      const said = parts && findFullName(text, parts);
      if (said && !out.some((v) => v.includes(said))) add(said);
    }
  }
  return out;
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${WEEKDAY_TITLES[weekdayOf(daysFromCivil(y, m, d))]}, ${MONTH_TITLES[m - 1]} ${d}`;
}

function formatTime(time: string): string {
  const [hh, mm] = time.split(":").map(Number);
  return `${hh % 12 === 0 ? 12 : hh % 12}:${pad(mm)} ${hh < 12 ? "AM" : "PM"}`;
}

/**
 * A committed value for display: a date as "Thursday, November 5", a time as "9:00 AM", a datetime as both
 * joined by "at", read in the zone the same way matchField reads it. Other types, and values it cannot read,
 * as given.
 */
export function formatValue(type: FieldType, value: unknown, tz: string, policyTz = false): string {
  if ((type === "date" || type === "time" || type === "datetime") && typeof value === "string") {
    const local = toLocal(value, tz, policyTz);
    const date = local.date && type !== "time" ? formatDate(local.date) : null;
    const time = local.time && type !== "date" ? formatTime(local.time) : null;
    if (date && time) return `${date} at ${time}`;
    if (date ?? time) return (date ?? time)!;
  }
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}

/** The committed value as display text, or null when it can't be compared: missing, scrubbed or unreadable. */
function committedDisplay(type: FieldType, value: unknown, ctx: MatchContext): string | null {
  if (value === null || value === undefined || isPlaceholder(value)) return null;
  switch (type) {
    case "date":
    case "time":
    case "datetime": {
      if (typeof value !== "string") return null;
      const local = toLocal(value, ctx.tz, ctx.policyTz);
      if ((type !== "time" && !local.date) || (type !== "date" && !local.time)) return null;
      return formatValue(type, value, ctx.tz, ctx.policyTz);
    }
    case "name":
      return typeof value === "string" && nameParts(value) ? value : null;
    case "number":
    case "money":
      return numberOf(value) === null ? null : String(value);
    case "id":
    case "string":
      return (typeof value === "string" || typeof value === "number" || typeof value === "boolean") && String(value).trim() ? String(value) : null;
  }
}

/**
 * One field row for a finding: what was said next to what was committed. A committed value that is missing, a
 * redaction placeholder or unreadable for its type is "unresolved" with committed null; it is never compared.
 */
export function fieldCheck(field: string, type: FieldType, text: string, committed: unknown, ctx: MatchContext): FieldCheck {
  let values = spokenValues(type, text, ctx);
  const shown = committedDisplay(type, committed, ctx);
  if (shown === null) return { field, type, from: "spoken", values, committed: null, status: "unresolved" };
  const status = matchField(type, text, committed, ctx);
  if (values.length === 0) {
    const said =
      type === "name" ? matchName(text, committed, ctx).said
      : type === "id" ? matchId(text, committed)
      : type === "string" ? matchString(text, committed)
      : type === "number" || type === "money" ? matchNumber(text, committed)
      : null;
    if (said) values = [said];
  }
  return { field, type, from: "spoken", values, committed: shown, status };
}
