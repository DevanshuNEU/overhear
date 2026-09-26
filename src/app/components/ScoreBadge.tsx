// ScoreBadge - the score as a monitor readout. Silent until it alarms: a good
// call is calm and colorless, a mixed call warms to amber, a poor call glows red
// and pulses like a detector going off.
function bandClasses(composite: number): string {
  if (composite >= 80) return "border-border text-foreground";
  if (composite >= 50) return "border-alarm-amber/40 bg-alarm-amber/10 text-alarm-amber";
  return "border-alarm-red/50 bg-alarm-red/10 text-alarm-red animate-alarm-pulse";
}

export function ScoreBadge({ composite }: { composite: number }) {
  const rounded = Math.round(composite);
  return (
    <span
      className={`inline-flex h-9 w-9 items-center justify-center rounded-full border font-mono text-sm font-medium tabular-nums ${bandClasses(composite)}`}
    >
      {rounded}
    </span>
  );
}

// ProcessingPill - a call that has ended but is not yet scored. Neutral, not an
// alarm: the detector is still listening, nothing is wrong yet.
export function ProcessingPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 animate-alarm-pulse rounded-full bg-alarm-amber" aria-hidden />
      Scoring
    </span>
  );
}
