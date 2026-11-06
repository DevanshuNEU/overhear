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
