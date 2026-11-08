// Marks the words that made a claim inside the turn they were said in.
import { Fragment } from "react";
import type { ReactNode } from "react";
import { readableSpans, type Span } from "./readable";

/**
 * A spoken number, held in both forms. The page's own style (globals.css, keyed on data-numbers) decides which one
 * shows: the digits, with a dotted underline and the exact words as the tooltip and for a screen reader, or the exact
 * words alone. Both are in the page, so the choice needs no client code here. The digits are hidden from assistive
 * tech and from a selection, so a copy takes what is on screen.
 */
function Digits({ shown, exact }: { shown: string; exact: string }) {
  return (
    <span data-readable title={exact}>
      <span aria-hidden data-digits>
        {shown}
      </span>
      <span data-exact>{exact}</span>
    </span>
  );
}

/** A quote with a mark of its own, for a turn whose claims belong to findings with different results. */
export type MarkedQuote = { quote: string; markClass: string };

/** A range of the text a quote marks. */
export type MarkedRange = { start: number; end: number; markClass: string; order: number };

/**
 * The ranges of the text that quotes mark: each quote's first occurrence, with quotes that share words or overlap
 * merged into one range that takes the class of the quote listed first. A quote that is not in the text is ignored.
 * markQuotes draws these, and a caller that must keep their words exact reads them too, so the two cannot drift.
 */
export function markedRanges(text: string, quotes: (string | MarkedQuote)[], markClass: string): MarkedRange[] {
  const found = quotes
    .map((q, order) => (typeof q === "string" ? { quote: q, markClass, order } : { ...q, order }))
    .map((q) => ({ start: text.indexOf(q.quote), end: text.indexOf(q.quote) + q.quote.length, markClass: q.markClass, order: q.order }))
    .filter((s) => s.start >= 0 && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const merged: MarkedRange[] = [];
  for (const s of found) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
      if (s.order < last.order) Object.assign(last, { markClass: s.markClass, order: s.order });
    } else merged.push({ ...s });
  }
  return merged;
}

/**
 * Splits a turn's text so each quoted span is marked and the rest stays plain. A quote is a string, marked with
 * `markClass`, or a MarkedQuote with its own class (see markedRanges for how they merge).
 *
 * With `readable`, spoken numbers outside a mark show as digits (see readable.ts). A mark always shows the exact
 * words, so a number that a mark touches stays as spoken. A caller that has already read the turn passes its
 * `spans` (read with the marked ranges kept exact) instead, so the turn is read once.
 */
export function markQuotes(text: string, quotes: (string | MarkedQuote)[], markClass: string, opts?: { readable?: boolean; spans?: Span[] }): ReactNode {
  const merged = markedRanges(text, quotes, markClass);
  const spans = opts?.spans ?? (opts?.readable ? readableSpans(text, merged) : []);
  // The words from `from` to `to`, with the digits for any spoken number inside.
  const plain = (from: number, to: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let cursor = from;
    for (const sp of spans.filter((x) => x.start >= from && x.end <= to)) {
      if (sp.start > cursor) out.push(text.slice(cursor, sp.start));
      out.push(<Digits key={sp.start} shown={sp.shown} exact={sp.exact} />);
      cursor = sp.end;
    }
    if (cursor < to) out.push(text.slice(cursor, to));
    return out;
  };
  const parts: ReactNode[] = [];
  let at = 0;
  for (const s of merged) {
    if (s.start > at) parts.push(...plain(at, s.start));
    parts.push(
      <mark key={s.start} className={`rounded-sm px-0.5 text-report-ink ${s.markClass}`}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    at = s.end;
  }
  if (at < text.length) parts.push(...plain(at, text.length));
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
