// Overhear dashboard home page. Queries the database at request time
// (never at build time; see the `dynamic` export below), so it cannot be
// statically prerendered.
import { db } from "@/db/client";
import { ensureDemoData } from "@/demo/ensure";
import { failureBreakdown, listCalls } from "@/qa/queries";
import { AutoRefresh } from "./components/AutoRefresh";
import { CallList } from "./components/CallList";
import { FailureBreakdown } from "./components/FailureBreakdown";
import { TryItCard } from "./components/TryItCard";
import { WebCallWidget } from "./components/WebCallWidget";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Keep the shared demo self-serving: make sure the test personas and enough
  // near-term open slots exist before showing the page. Throttled internally, so
  // the 5-second auto-refresh does not turn this into a write on every poll. A
  // failure here must never take down the dashboard, so it is logged, not thrown.
  await ensureDemoData(db).catch((err) => console.error("ensureDemoData failed", err));

  const [calls, failures] = await Promise.all([listCalls(db), failureBreakdown(db)]);

  return (
    <div className="min-h-full bg-zinc-950">
      <AutoRefresh />
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-zinc-100">Overhear</h1>
          <p className="text-sm text-zinc-400">
            QA scores for every call the voice agent has handled, newest first.
          </p>
        </header>

        <WebCallWidget />

        <TryItCard />

        <FailureBreakdown items={failures} />

        <CallList calls={calls} />
      </main>
    </div>
  );
}
