// Call detail page - the composite score, per-dimension pass/fail with
// rationale, the LLM summary, the annotated transcript, and how this call's
// score sits in the overall trend. Queries the database at request time
// (never at build time; see the `dynamic` export below), so it cannot be
// statically prerendered.
import Link from "next/link";
import { annotateTranscript } from "@/domain/annotate";
import type { TranscriptObject } from "@/domain/types";
import { db } from "@/db/client";
import { getCall, scoreTrend } from "@/qa/queries";
import { AutoRefresh } from "../../components/AutoRefresh";
import { DIMENSION_LABELS } from "../../components/labels";
import { ProcessingPill, ScoreBadge } from "../../components/ScoreBadge";
import { TranscriptViewer } from "../../components/TranscriptViewer";
import { TrendChart } from "../../components/TrendChart";

export const dynamic = "force-dynamic";

function PassFailChip({ passed }: { passed: boolean }) {
  const classes = passed
    ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400"
    : "rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-400";
  return <span className={classes}>{passed ? "Pass" : "Fail"}</span>;
}

export default async function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [call, trend] = await Promise.all([getCall(db, id), scoreTrend(db)]);

  if (!call) {
    return (
      <div className="min-h-full bg-background">
        <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-16">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Back to calls
          </Link>
          <p className="text-sm text-muted-foreground">No call found with this id.</p>
        </main>
      </div>
    );
  }

  const isProcessing = call.status === "processing";
  const { utterances, unmatchedFlags } = annotateTranscript(
    call.transcript as TranscriptObject,
    call.dimensions,
  );

  return (
    <div className="min-h-full bg-background">
      {/* Keep a processing call's page live: it swaps in the score the moment
          scoring finishes, no manual reload. */}
      {isProcessing && <AutoRefresh />}
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16">
        <div className="flex flex-col gap-2">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            Back to calls
          </Link>
          <div className="flex items-center gap-3">
            {isProcessing || call.composite === null ? (
              <ProcessingPill />
            ) : (
              <ScoreBadge composite={call.composite} />
            )}
            <h1 className="font-mono text-lg text-foreground">{call.id}</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            {isProcessing
              ? "Call ended, waiting on analysis before scoring."
              : `Scored ${new Date(call.scoredAt!).toLocaleString()}, judged by ${call.judgeSource}`}
          </p>
        </div>

        {!isProcessing && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Summary</h2>
            <p className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground">
              {call.summary}
            </p>
            {call.retellSummary && (
              <p className="text-sm text-muted-foreground">Retell summary: {call.retellSummary}</p>
            )}
          </section>
        )}

        {!isProcessing && (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Dimensions</h2>
            <ul className="flex flex-col gap-2">
              {call.dimensions.map((dimension) => (
                <li
                  key={dimension.key}
                  className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-foreground">{DIMENSION_LABELS[dimension.key]}</span>
                    <PassFailChip passed={dimension.passed} />
                  </div>
                  <p className="text-sm text-muted-foreground">{dimension.rationale}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Transcript</h2>
          <TranscriptViewer utterances={utterances} unmatchedFlags={unmatchedFlags} />
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Score trend</h2>
          <TrendChart data={trend} />
        </section>
      </main>
    </div>
  );
}
