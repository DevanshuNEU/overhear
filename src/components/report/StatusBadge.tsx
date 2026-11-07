// A status is a glyph and a word, never colour alone. The badge is read-only.
import { Check, Minus, TriangleAlert, X } from "lucide-react";
import { RESULT_LABEL, VERDICT_LABEL } from "@/report/labels";
import type { Result, Verdict } from "@/report/schema";

export type Tone = "critical" | "warning" | "calm" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  critical: "bg-report-critical-tint text-report-critical",
  warning: "bg-report-warning-tint text-report-warning",
  calm: "bg-report-calm-mark text-report-ink",
  muted: "text-report-muted",
};

const TONE_ICON = { critical: X, warning: TriangleAlert, calm: Check, muted: Minus };

export const RESULT_TONE: Record<Result, Tone> = {
  violated: "critical",
  unverified: "warning",
  passed: "calm",
  not_applicable: "muted",
  not_run: "muted",
};

export const VERDICT_TONE: Record<Verdict, Tone> = {
  failed: "critical",
  needs_review: "warning",
  passed: "calm",
};

export function Badge({ tone, label }: { tone: Tone; label: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-medium ${TONE_CLASS[tone]}`}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
      {label}
    </span>
  );
}

export function ResultBadge({ result }: { result: Result }) {
  return <Badge tone={RESULT_TONE[result]} label={RESULT_LABEL[result]} />;
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge tone={VERDICT_TONE[verdict]} label={VERDICT_LABEL[verdict]} />;
}
