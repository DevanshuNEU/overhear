// src/qa/pipeline.ts - the QA pipeline orchestrator. Takes the Retell
// `call_analyzed` webhook payload, builds a CallContext from it plus the DB
// state (action events, open slots), runs the reconciler and the judge,
// composes the seven dimensions into a score, narrates it, and persists both
// the `calls` row and the `qa_scores` row.
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { actionEvents, appointmentSlots, calls, providers, qaScores } from "@/db/schema";
import { composite } from "@/domain/rubric";
import { reconcile } from "@/domain/reconciler";
import type {
  ActionEvent, CallContext, CompositeScore, DimensionScore,
  Role, Slot, TranscriptObject, Utterance, Word,
} from "@/domain/types";
import { makeJudge } from "@/judge/judge";
import { summarizeCall } from "@/judge/narrator";

// The Retell `call` object from a `call_analyzed` webhook. Only the fields
// this pipeline reads are declared here; the SDK's full response type has
// many more optional fields we don't use.
export interface RetellCall {
  call_id: string;
  transcript?: string;
  transcript_object?: Array<{
    role: string;
    content?: string;
    words?: Array<{ word?: string; start?: number; end?: number }>;
  }>;
  recording_url?: string;
  call_analysis?: {
    user_sentiment?: string;
    call_summary?: string;
  };
  [key: string]: unknown;
}

const ROLES: Role[] = ["agent", "user"];

function isDomainRole(role: string): role is Role {
  return (ROLES as string[]).includes(role);
}

function toTranscript(call: RetellCall): TranscriptObject {
  return (call.transcript_object ?? [])
    .filter((u) => isDomainRole(u.role))
    .map((u): Utterance => ({
      role: u.role as Role,
      content: u.content ?? "",
      words: (u.words ?? []).map((w): Word => ({ word: w.word ?? "", start: w.start ?? 0, end: w.end ?? 0 })),
    }));
}

function transcriptToText(transcript: TranscriptObject): string {
  return transcript.map((u) => `${u.role}: ${u.content}`).join("\n");
}

function toActionEvent(row: typeof actionEvents.$inferSelect): ActionEvent {
  return {
    id: row.id,
    callId: row.callId,
    tool: row.tool as ActionEvent["tool"],
    args: row.args as Record<string, unknown>,
    result: row.result as Record<string, unknown>,
    ok: row.ok,
    ts: new Date(row.ts).toISOString(),
  };
}

async function loadActionEvents(callId: string): Promise<ActionEvent[]> {
  const rows = await db.select().from(actionEvents).where(eq(actionEvents.callId, callId));
  return rows.map(toActionEvent);
}

async function loadOpenSlots(): Promise<Slot[]> {
  const rows = await db.select({
    id: appointmentSlots.id,
    providerId: appointmentSlots.providerId,
    providerName: providers.name,
    startsAt: appointmentSlots.startsAt,
    status: appointmentSlots.status,
  }).from(appointmentSlots)
    .innerJoin(providers, eq(appointmentSlots.providerId, providers.id))
    .where(eq(appointmentSlots.status, "open"));
  return rows.map((r): Slot => ({
    id: r.id,
    providerId: r.providerId,
    providerName: r.providerName,
    startsAt: new Date(r.startsAt).toISOString(),
    status: r.status as Slot["status"],
  }));
}

async function buildContext(call: RetellCall): Promise<CallContext> {
  const transcript = toTranscript(call);
  const [callActionEvents, trueSlots] = await Promise.all([
    loadActionEvents(call.call_id),
    loadOpenSlots(),
  ]);
  return {
    callId: call.call_id,
    transcript,
    actionEvents: callActionEvents,
    trueSlots,
    callerGoal: call.call_analysis?.call_summary ?? null,
  };
}

// Record a call the moment it ends (call_ended webhook), before it has been
// scored. This writes only the `calls` row, no `qa_scores`, so the dashboard's
// left join surfaces it as "processing" until call_analyzed fires and
// scoreCall fills in the score. onConflictDoUpdate keeps this idempotent: if
// call_analyzed somehow lands first, its richer transcript is not clobbered by
// a later call_ended carrying the same or older data.
export async function recordPendingCall(call: RetellCall): Promise<void> {
  const transcript = toTranscript(call);
  const values = {
    transcript,
    recordingUrl: call.recording_url ?? null,
    retellSentiment: call.call_analysis?.user_sentiment ?? null,
    retellSummary: call.call_analysis?.call_summary ?? null,
  };
  await db.insert(calls).values({ id: call.call_id, ...values }).onConflictDoUpdate({
    target: calls.id,
    set: values,
  });
}

export async function scoreCall(call: RetellCall): Promise<CompositeScore> {
  const ctx = await buildContext(call);

  const rec = reconcile(ctx);
  const judge = makeJudge();
  const jr = await judge.score(ctx);

  const dimensions: DimensionScore[] = [
    rec.task_success, rec.correct_tool_use, rec.identity_verified,
    jr.no_hallucination, jr.conversational_quality, jr.safety_escalation,
    jr.confirmed_before_acting,
  ];
  const compositeScore = composite(dimensions);
  const summary = await summarizeCall({
    dimensions,
    failureCategories: jr.failureCategories,
    transcriptText: transcriptToText(ctx.transcript),
  });

  const judgeSource = judge.source;

  // Persist the call and its score atomically: if the qa_scores write fails,
  // the calls write must not be left committed on its own (the dashboard
  // inner-joins the two, so a half-write would leave an invisible orphan row).
  await db.transaction(async (tx) => {
    await tx.insert(calls).values({
      id: call.call_id,
      transcript: ctx.transcript,
      recordingUrl: call.recording_url ?? null,
      retellSentiment: call.call_analysis?.user_sentiment ?? null,
      retellSummary: call.call_analysis?.call_summary ?? null,
    }).onConflictDoUpdate({
      target: calls.id,
      set: {
        transcript: ctx.transcript,
        recordingUrl: call.recording_url ?? null,
        retellSentiment: call.call_analysis?.user_sentiment ?? null,
        retellSummary: call.call_analysis?.call_summary ?? null,
      },
    });

    await tx.insert(qaScores).values({
      callId: call.call_id,
      composite: compositeScore,
      dimensions,
      failureCategories: jr.failureCategories,
      judgeSource,
      summary,
    }).onConflictDoUpdate({
      target: qaScores.callId,
      set: {
        composite: compositeScore,
        dimensions,
        failureCategories: jr.failureCategories,
        judgeSource,
        summary,
      },
    });
  });

  return {
    callId: call.call_id,
    dimensions,
    composite: compositeScore,
    failureCategories: jr.failureCategories,
    judgeSource,
    summary,
  };
}
