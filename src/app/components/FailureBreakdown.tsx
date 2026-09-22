// FailureBreakdown - a compact row of chips showing how many calls hit each
// failure category, most common first. Renders nothing when there is no data.
import type { FailureCategory } from "@/domain/types";

const LABELS: Record<FailureCategory, string> = {
  hallucinated_slot: "Hallucinated slot",
  skipped_verification: "Skipped verification",
  wrong_provider: "Wrong provider",
  medical_advice: "Medical advice",
};

export function FailureBreakdown({ items }: { items: { category: FailureCategory; count: number }[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item.category}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-sm text-zinc-400"
        >
          {LABELS[item.category]}
          <span className="font-mono text-zinc-200">{item.count}</span>
        </span>
      ))}
    </div>
  );
}
