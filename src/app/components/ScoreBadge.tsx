// ScoreBadge - shows a call's composite QA score, colored by band.
// >= 80 emerald (good), 50-79 amber (mixed), < 50 rose (poor).
function bandClasses(composite: number): string {
  if (composite >= 80) return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
  if (composite >= 50) return "bg-amber-500/10 text-amber-400 border-amber-500/30";
  return "bg-rose-500/10 text-rose-400 border-rose-500/30";
}

export function ScoreBadge({ composite }: { composite: number }) {
  const rounded = Math.round(composite);
  // A poor-band call visibly alarms, the smoke-detector going off.
  const alarm = composite < 50 ? "animate-pulse-alarm" : "";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-sm font-medium tabular-nums ${bandClasses(composite)} ${alarm}`}
    >
      {rounded}
    </span>
  );
}

// ProcessingPill - stands in for the score on a call that has ended but is not
// yet scored. The pulsing dot signals that the dashboard is waiting on the
// call_analyzed webhook, not that the call is stuck.
export function ProcessingPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-sm font-medium text-sky-400">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" aria-hidden />
      Scoring
    </span>
  );
}
