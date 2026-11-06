// Marks the words that made a claim inside the turn they were said in.
import { Fragment } from "react";
import type { ReactNode } from "react";

/**
 * Splits a turn's text so each quoted span is marked and the rest stays plain. Quotes that share words or
 * overlap are merged into one mark, and a quote that is not in the text is ignored. The first occurrence
 * of a quote is the one marked.
 */
export function markQuotes(text: string, quotes: string[], markClass: string): ReactNode {
  const found = quotes
    .map((q) => ({ start: text.indexOf(q), end: text.indexOf(q) + q.length }))
    .filter((s) => s.start >= 0 && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const s of found) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }
  const parts: ReactNode[] = [];
  let at = 0;
  for (const s of merged) {
    if (s.start > at) parts.push(text.slice(at, s.start));
    parts.push(
      <mark key={s.start} className={`rounded-sm px-0.5 text-report-ink ${markClass}`}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    at = s.end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts.map((p, i) => <Fragment key={i}>{p}</Fragment>);
}

const ABBREVIATION = /\b(?:Dr|Mr|Mrs|Ms|St|Jr|Sr|vs|a\.m|p\.m)\.$/i;

/** Each sentence of a turn with where it starts and ends in the text. A stream can leave no space after a full stop. */
function sentenceSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/[.!?]/.test(text[i])) continue;
    let j = i;
    while (j + 1 < text.length && /[.!?]/.test(text[j + 1])) j++;
    const next = text[j + 1];
    const ends = next === undefined || /\s/.test(next) || /["\u201c'A-Z]/.test(next);
    if (ends && !(text[i] === "." && ABBREVIATION.test(text.slice(start, j + 1)))) {
      spans.push({ start, end: j + 1 });
      start = j + 1;
      while (start < text.length && /\s/.test(text[start])) start++;
    }
    i = j;
  }
  if (start < text.length && text.slice(start).trim()) spans.push({ start, end: text.length });
  return spans.map((s) => ({ start: s.start, end: s.start + text.slice(s.start, s.end).trimEnd().length }));
}

/** The sentences of a turn. It does not split after a title or an abbreviation such as Dr. or a.m. */
export function sentencesOf(text: string): string[] {
  return sentenceSpans(text).map((s) => text.slice(s.start, s.end));
}

/**
 * The part of a turn to show first: the sentence that holds the claim and one either side. Null when there is no
 * claim to centre on, or when that window is already the whole turn, so nothing is hidden for nothing.
 */
export function windowAround(text: string, quotes: string[]): { text: string; hidden: true } | null {
  const spans = sentenceSpans(text);
  const holding = quotes.flatMap((q) => {
    const at = text.indexOf(q);
    if (at < 0) return [];
    const i = spans.findIndex((s) => at >= s.start && at < s.end + 1);
    return i < 0 ? [] : [i];
  });
  if (holding.length === 0) return null;
  const first = Math.max(0, Math.min(...holding) - 1);
  const last = Math.min(spans.length - 1, Math.max(...holding) + 1);
  if (first === 0 && last === spans.length - 1) return null;
  return { text: text.slice(spans[first].start, spans[last].end), hidden: true };
}
