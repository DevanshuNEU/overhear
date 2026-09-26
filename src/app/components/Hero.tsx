// Hero - the product framing at the top of the home page. Text and the headline
// accuracy stat; the live call panel sits beside it (see page.tsx), so there is
// no duplicate call CTA here. The animated amber-to-red wash is the Signal mark.
import Link from "next/link";
import { CountUp } from "./CountUp";

export function Hero({ caught, planted, sample }: { caught: number; planted: number; sample: boolean }) {
  return (
    <section className="relative flex h-full flex-col justify-center overflow-hidden rounded-2xl border border-border bg-card px-6 py-12 sm:px-10">
      <div
        aria-hidden
        className="animate-gradient-pan pointer-events-none absolute inset-0 opacity-20"
        style={{ background: "linear-gradient(125deg, #f59e0b 0%, #ef4444 40%, transparent 68%)" }}
      />
      <div className="relative flex flex-col gap-5">
        <span className="text-xs font-medium uppercase tracking-[0.22em] text-signal-amber">Voice-agent QA</span>
        <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight text-foreground sm:text-5xl">
          A smoke detector
          <br />
          for voice agents
        </h1>
        <p className="max-w-md text-base text-muted-foreground sm:text-lg">
          It scores every call the agent handles, and it measures how accurate that scoring actually is.
        </p>
        <Link
          href="/eval"
          className="group mt-1 inline-flex w-fit items-center gap-3 rounded-xl border border-border bg-background/40 px-4 py-3 backdrop-blur transition-colors hover:border-signal-amber/60"
        >
          <span className="text-3xl font-semibold tabular-nums text-signal-amber">
            <CountUp value={caught} />
            <span className="text-muted-foreground">/{planted}</span>
          </span>
          <span className="text-sm text-muted-foreground">
            planted failures caught{sample && <span className="text-muted-foreground/60"> (sample)</span>}
            <br />
            <span className="text-foreground group-hover:text-signal-amber">see how we measure it &rarr;</span>
          </span>
        </Link>
      </div>
    </section>
  );
}
