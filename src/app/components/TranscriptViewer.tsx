// TranscriptViewer - renders an annotated transcript: one row per utterance,
// with a chip for each failed dimension flagged on that line. Failed
// dimensions that could not be matched to a specific line show in a banner
// above the transcript instead. Presentational only.
import type { AnnotatedUtterance } from "@/domain/annotate";
import type { DimensionKey, Role } from "@/domain/types";
import { DIMENSION_LABELS } from "./labels";

function roleLabel(role: Role): string {
  return role === "agent" ? "Agent" : "Caller";
}

function FlagChip({ flag }: { flag: DimensionKey }) {
  return (
    <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-xs text-rose-300">
      {DIMENSION_LABELS[flag]}
    </span>
  );
}

export function TranscriptViewer({
  utterances,
  unmatchedFlags,
}: {
  utterances: AnnotatedUtterance[];
  unmatchedFlags: DimensionKey[];
}) {
  return (
    <div className="flex flex-col gap-3">
      {unmatchedFlags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          <span>Flagged, but not tied to a specific line:</span>
          {unmatchedFlags.map((flag) => (
            <FlagChip key={flag} flag={flag} />
          ))}
        </div>
      )}

      <ol className="flex flex-col gap-2">
        {utterances.map((item, index) => (
          <li
            key={index}
            className="flex flex-col gap-1 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {roleLabel(item.utterance.role)}
              </span>
              {item.flags.map((flag) => (
                <FlagChip key={flag} flag={flag} />
              ))}
            </div>
            <p className="font-mono text-sm text-zinc-100">{item.utterance.content}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
