/* eslint-disable @typescript-eslint/no-explicit-any -- `db` must accept both the postgres-js DB
 * (production) and the PGlite test DB (createTestDb); their drizzle instance/transaction types
 * don't unify, so these read queries are intentionally untyped at the driver boundary. */
// src/qa/queries.ts - read-only queries backing the dashboard. Shapes here
// mirror exactly what src/qa/pipeline.ts writes into `calls` and `qa_scores`.
import { asc, desc, eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { calls, qaScores } from "@/db/schema";
import type { DimensionScore, FailureCategory } from "@/domain/types";

export interface CallSummary {
  id: string;
  // A call is "processing" from the moment it ends (call_ended webhook records
  // it) until call_analyzed arrives and scoring writes its qa_scores row. In
  // that window everything below that comes from qa_scores is null.
  status: "scored" | "processing";
  composite: number | null;
  failureCategories: FailureCategory[];
  retellSentiment: string | null;
  scoredAt: string | null; // ISO 8601, null while processing
  startedAt: string; // ISO 8601, when the call was first recorded
}

export interface CallDetail extends CallSummary {
  transcript: unknown; // TranscriptObject, stored as jsonb
  summary: string | null;
  dimensions: DimensionScore[]; // empty while processing
  judgeSource: "jev" | "claude" | null;
  retellSummary: string | null;
}

function toIso(value: unknown): string {
  return new Date(value as string).toISOString();
}

export async function listCalls(db: DB | any): Promise<CallSummary[]> {
  // Left join, not inner: a call that has ended but is not yet scored has a
  // `calls` row and no `qa_scores` row, and it must still show on the dashboard
  // as "processing". Ordered by startedAt so a call that just came in sits at
  // the top the moment it ends, before it finishes scoring.
  const rows = await db
    .select({
      id: calls.id,
      composite: qaScores.composite,
      failureCategories: qaScores.failureCategories,
      retellSentiment: calls.retellSentiment,
      scoredAt: qaScores.scoredAt,
      startedAt: calls.startedAt,
    })
    .from(calls)
    .leftJoin(qaScores, eq(calls.id, qaScores.callId))
    .orderBy(desc(calls.startedAt));

  return rows.map((row: any): CallSummary => ({
    id: row.id,
    status: row.composite === null ? "processing" : "scored",
    composite: row.composite,
    failureCategories: (row.failureCategories ?? []) as FailureCategory[],
    retellSentiment: row.retellSentiment,
    scoredAt: row.scoredAt ? toIso(row.scoredAt) : null,
    startedAt: toIso(row.startedAt),
  }));
}

export async function getCall(db: DB | any, id: string): Promise<CallDetail | null> {
  const rows = await db
    .select({
      id: calls.id,
      composite: qaScores.composite,
      failureCategories: qaScores.failureCategories,
      retellSentiment: calls.retellSentiment,
      retellSummary: calls.retellSummary,
      scoredAt: qaScores.scoredAt,
      startedAt: calls.startedAt,
      transcript: calls.transcript,
      summary: qaScores.summary,
      dimensions: qaScores.dimensions,
      judgeSource: qaScores.judgeSource,
    })
    .from(calls)
    .leftJoin(qaScores, eq(calls.id, qaScores.callId))
    .where(eq(calls.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    status: row.composite === null ? "processing" : "scored",
    composite: row.composite,
    failureCategories: (row.failureCategories ?? []) as FailureCategory[],
    retellSentiment: row.retellSentiment,
    retellSummary: row.retellSummary,
    scoredAt: row.scoredAt ? toIso(row.scoredAt) : null,
    startedAt: toIso(row.startedAt),
    transcript: row.transcript,
    summary: row.summary,
    dimensions: (row.dimensions ?? []) as DimensionScore[],
    judgeSource: row.judgeSource as "jev" | "claude" | null,
  };
}

export async function failureBreakdown(db: DB | any): Promise<{ category: FailureCategory; count: number }[]> {
  const rows = await db.select({ failureCategories: qaScores.failureCategories }).from(qaScores);

  const counts = new Map<FailureCategory, number>();
  for (const row of rows as { failureCategories: FailureCategory[] }[]) {
    for (const category of row.failureCategories) {
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

export async function scoreTrend(db: DB | any): Promise<{ scoredAt: string; composite: number }[]> {
  const rows = await db
    .select({ scoredAt: qaScores.scoredAt, composite: qaScores.composite })
    .from(qaScores)
    .orderBy(asc(qaScores.scoredAt));

  return rows.map((row: any) => ({ scoredAt: toIso(row.scoredAt), composite: row.composite }));
}
