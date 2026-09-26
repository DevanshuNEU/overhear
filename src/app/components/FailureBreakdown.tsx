// FailureBreakdown - a compact row of chips showing how many calls hit each
// failure category, most common first. Renders nothing when there is no data.
import type { FailureCategory } from "@/domain/types";
import { Badge } from "@/components/ui/badge";
import { FAILURE_LABELS } from "./labels";

export function FailureBreakdown({ items }: { items: { category: FailureCategory; count: number }[] }) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item.category} variant="secondary" className="gap-1.5 font-normal">
          {FAILURE_LABELS[item.category]}
          <span className="font-mono font-medium text-foreground">{item.count}</span>
        </Badge>
      ))}
    </div>
  );
}
