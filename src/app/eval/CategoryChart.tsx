"use client";

// Grouped bar chart of precision and recall per failure category. Client-only
// (recharts). The shadcn ChartContainer maps the config colors to CSS vars.
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { FAILURE_LABELS } from "../components/labels";
import type { CategoryMetric } from "@/eval/report";
import type { FailureCategory } from "@/domain/types";

const config = {
  precision: { label: "Precision", color: "#f59e0b" },
  recall: { label: "Recall", color: "#10b981" },
} satisfies ChartConfig;

export function CategoryChart({ perCategory }: { perCategory: Record<string, CategoryMetric> }) {
  const data = Object.entries(perCategory).map(([cat, m]) => ({
    category: FAILURE_LABELS[cat as FailureCategory] ?? cat,
    precision: Math.round(m.precision * 100),
    recall: Math.round(m.recall * 100),
  }));

  return (
    <ChartContainer config={config} className="h-56 w-full">
      <BarChart data={data} margin={{ left: -12, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="category"
          tickLine={false}
          axisLine={false}
          interval={0}
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <YAxis
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          width={34}
          unit="%"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="precision" fill="var(--color-precision)" radius={3} />
        <Bar dataKey="recall" fill="var(--color-recall)" radius={3} />
      </BarChart>
    </ChartContainer>
  );
}
