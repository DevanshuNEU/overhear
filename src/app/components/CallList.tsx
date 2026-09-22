// CallList - the dashboard's main table: one row per scored call, newest
// first. Presentational only; the page component supplies the data.
import Link from "next/link";
import type { CallSummary } from "@/qa/queries";
import { ScoreBadge } from "./ScoreBadge";

const FAILURE_LABELS: Record<string, string> = {
  hallucinated_slot: "Hallucinated slot",
  skipped_verification: "Skipped verification",
  wrong_provider: "Wrong provider",
  medical_advice: "Medical advice",
};

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
    return <p className="text-sm text-zinc-400">No scored calls yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {calls.map((call) => (
        <li key={call.id}>
          <Link
            href={`/calls/${call.id}`}
            className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 transition-colors hover:border-zinc-700 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-center gap-3">
              <ScoreBadge composite={call.composite} />
              <span className="font-mono text-sm text-zinc-400">{call.id}</span>
              {call.retellSentiment && (
                <span className="text-sm text-zinc-400">{call.retellSentiment.toLowerCase()}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {call.failureCategories.map((category) => (
                <span
                  key={category}
                  className="rounded-full border border-zinc-800 px-2 py-0.5 text-xs text-zinc-400"
                >
                  {FAILURE_LABELS[category] ?? category}
                </span>
              ))}
              <span className="text-sm text-zinc-500">{relativeTime(call.scoredAt)}</span>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
