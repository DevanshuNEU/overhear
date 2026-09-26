// CallList - the dashboard's call feed. Each row leads with the score and what
// happened; the raw call id is demoted to a small mono line so the feed reads
// like a product, not a log. Presentational only.
import Link from "next/link";
import type { CallSummary } from "@/qa/queries";
import { Badge } from "@/components/ui/badge";
import { FAILURE_LABELS } from "./labels";
import { ProcessingPill, ScoreBadge } from "./ScoreBadge";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function CallList({ calls }: { calls: CallSummary[] }) {
  if (calls.length === 0) {
    return <p className="text-sm text-muted-foreground">No calls yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {calls.map((call) => (
        <li key={call.id}>
          <Link
            href={`/calls/${call.id}`}
            className="group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-accent"
          >
            {call.status === "processing" || call.composite === null ? (
              <ProcessingPill />
            ) : (
              <ScoreBadge composite={call.composite} />
            )}

            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {call.failureCategories.length > 0 ? (
                  call.failureCategories.map((category) => (
                    <Badge key={category} variant="destructive" className="bg-signal-red/15 text-signal-red">
                      {FAILURE_LABELS[category] ?? category}
                    </Badge>
                  ))
                ) : (
                  <span className="text-sm text-muted-foreground">No issues flagged</span>
                )}
                {call.retellSentiment && (
                  <Badge variant="secondary" className="font-normal">
                    {call.retellSentiment.toLowerCase()}
                  </Badge>
                )}
              </div>
              <span className="truncate font-mono text-xs text-muted-foreground/70">{call.id}</span>
            </div>

            <span className="shrink-0 text-xs text-muted-foreground">
              {relativeTime(call.scoredAt ?? call.startedAt)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
