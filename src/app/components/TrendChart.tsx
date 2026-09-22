"use client";
// TrendChart - a line of composite QA scores over time, oldest to newest.
// Client component: Recharts measures and renders into the DOM, so it cannot
// run as a server component. Keep this the only Recharts import in the app.
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TrendChart({ data }: { data: { scoredAt: string; composite: number }[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-zinc-400">Not enough scored calls yet for a trend.</p>;
  }

  const points = data.map((point) => ({ label: formatDate(point.scoredAt), composite: point.composite }));

  return (
    <div className="h-56 w-full rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} width={32} />
          <Tooltip
            contentStyle={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 8 }}
            labelStyle={{ color: "#a1a1aa" }}
            itemStyle={{ color: "#34d399" }}
          />
          <Line type="monotone" dataKey="composite" stroke="#34d399" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
