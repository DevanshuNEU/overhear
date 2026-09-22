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
  composite: number;
  failureCategories: FailureCategory[];
  retellSentiment: string | null;
  scoredAt: string; // ISO 8601
}

export interface CallDetail extends CallSummary {
  transcript: unknown; // TranscriptObject, stored as jsonb
  summary: string;
  dimensions: DimensionScore[];
  judgeSource: "jev" | "claude";
  retellSummary: string | null;
}

function toIso(value: unknown): string {
  return new Date(value as string).toISOString();
}

export async function listCalls(db: DB | any): Promise<CallSummary[]> {
  const rows = await db
    .select({
      id: calls.id,
      composite: qaScores.composite,
      failureCategories: qaScores.failureCategories,
      retellSentiment: calls.retellSentiment,
      scoredAt: qaScores.scoredAt,
    })
    .from(calls)
    .innerJoin(qaScores, eq(calls.id, qaScores.callId))
    .orderBy(desc(qaScores.scoredAt));

  return rows.map((row: any): CallSummary => ({
    id: row.id,
    composite: row.composite,
    failureCategories: row.failureCategories as FailureCategory[],
    retellSentiment: row.retellSentiment,
    scoredAt: toIso(row.scoredAt),
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
      transcript: calls.transcript,
      summary: qaScores.summary,
      dimensions: qaScores.dimensions,
      judgeSource: qaScores.judgeSource,
    })
    .from(calls)
    .innerJoin(qaScores, eq(calls.id, qaScores.callId))
    .where(eq(calls.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    composite: row.composite,
    failureCategories: row.failureCategories as FailureCategory[],
    retellSentiment: row.retellSentiment,
    retellSummary: row.retellSummary,
    scoredAt: toIso(row.scoredAt),
    transcript: row.transcript,
    summary: row.summary,
    dimensions: row.dimensions as DimensionScore[],
    judgeSource: row.judgeSource as "jev" | "claude",
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
