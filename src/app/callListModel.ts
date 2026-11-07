// What the call list works out from a pull's rows, apart from how it looks: counts, which rows go on top, and
// how a call's time reads. Pure, so each rule has a test of its own.
import type { PullRow } from "@/pull/pull";

export type Counts = {
  total: number;
  failed: number;
  needsReview: number;
  passed: number;
  /** Calls with no transcript, so there was nothing to check. */
  noContent: number;
  /** Calls Overhear could not fetch or check. */
  errored: number;
  /** Calls still waiting for their turn. */
  pending: number;
};

export function countRows(rows: PullRow[]): Counts {
  const counts: Counts = { total: rows.length, failed: 0, needsReview: 0, passed: 0, noContent: 0, errored: 0, pending: 0 };
  for (const row of rows) {
    if (row.state === "pending") counts.pending++;
    else if (row.state === "no_content") counts.noContent++;
    else if (row.state === "error") counts.errored++;
    else if (row.verdict === "failed") counts.failed++;
    else if (row.verdict === "needs_review") counts.needsReview++;
    else counts.passed++;
  }
  return counts;
}

/** Where a row sorts among those that need a look: failed first, then needs review. Null for the rest. A call that did not load keeps its place and its Retry. */
function attentionRank(row: PullRow): number | null {
  if (row.state !== "report") return null;
  if (row.verdict === "failed") return 0;
  if (row.verdict === "needs_review") return 1;
  return null;
}

/** Failed and needs-review rows go first, in rank order; every other row keeps the order Retell listed them in (newest first). */
export function splitRows(rows: PullRow[]): { attention: PullRow[]; rest: PullRow[] } {
  const ranked = rows.map((row, index) => ({ row, index, rank: attentionRank(row) }));
  const attention = ranked.filter((r) => r.rank !== null).sort((a, b) => (a.rank as number) - (b.rank as number) || a.index - b.index);
  return { attention: attention.map((r) => r.row), rest: ranked.filter((r) => r.rank === null).map((r) => r.row) };
}

/** A call's start as "Nov 6, 15:42" in the reader's zone (or the one given). Null when the time cannot be printed. */
export function formatCallTime(ms: number, timeZone?: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(ms);
  } catch {
    return null;
  }
}

/** Whole seconds until the pause ends, at least 1 while it lasts. */
export function secondsLeft(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 1000));
}
