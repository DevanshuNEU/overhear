// Hero - opens with the product doing its job: an overheard call where the
// agent's bad line is caught. The signal strip is the one orchestrated motion.
import Link from "next/link";
import { CountUp } from "./CountUp";

// A fixed waveform silhouette for the "listening" strip. Heights are just a
// pleasing envelope, not live data.
const WAVE = [22, 40, 30, 58, 44, 72, 50, 86, 62, 96, 70, 54, 78, 46, 64, 34, 52, 28, 42, 24, 38, 20, 30, 18];

function SignalStrip() {
  return (
    <div className="animate-signal-sweep flex h-8 items-center gap-[3px]" aria-hidden>
      {WAVE.concat(WAVE).map((h, i) => (
        <span
          key={i}
          className="w-[3px] shrink-0 rounded-full bg-muted-foreground/30"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

function CaughtCall() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-background/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-1.5 w-1.5 animate-alarm-pulse rounded-full bg-alarm-amber" aria-hidden />
          Listening
        </span>
        <span className="font-mono text-xs text-muted-foreground/70">call_73ea</span>
      </div>

      <div className="flex flex-col gap-2.5 px-4 py-4 text-sm">
        <p className="text-muted-foreground">
          <span className="text-muted-foreground/60">Caller</span>&nbsp;&nbsp;Can I book with Dr. Nair please?
        </p>
        <div className="rounded-md border border-alarm-red/40 bg-alarm-red/10 px-3 py-2">
          <p className="text-foreground">
            <span className="text-muted-foreground/60">Agent</span>&nbsp;&nbsp;You&rsquo;re verified. I&rsquo;ve got you in with Dr. Osei on the 20th.
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-alarm-red">
            Caught &middot; wrong provider &middot; asked for Nair, booking Osei
          </p>
        </div>
        <p className="text-muted-foreground/60">Caller&nbsp;&nbsp;Okay, thanks.</p>
      </div>

      <div className="border-t border-border px-4 py-3">
        <SignalStrip />
      </div>
    </div>
  );
}

export function Hero({ caught, planted, sample }: { caught: number; planted: number; sample: boolean }) {
  return (
    <section className="grid gap-8 rounded-2xl border border-border bg-card px-6 py-10 sm:px-10 sm:py-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-5xl font-semibold leading-[0.98] tracking-tight text-foreground sm:text-6xl">
          A smoke detector for voice agents
        </h1>
        <p className="max-w-md text-lg leading-relaxed text-muted-foreground">
          It listens to every call the agent handles, catches the failures a human would miss, and measures how accurate
          its own catching really is.
        </p>
        <Link href="/eval" className="group flex items-baseline gap-3">
          <span className="font-mono text-4xl font-semibold tabular-nums text-alarm-amber">
            <CountUp value={caught} />
            <span className="text-muted-foreground/50">/{planted}</span>
          </span>
          <span className="text-sm leading-tight text-muted-foreground">
            planted failures caught{sample && <span className="text-muted-foreground/50"> (sample)</span>}
            <br />
            <span className="text-foreground underline-offset-4 group-hover:underline">how we measure that</span>
          </span>
        </Link>
      </div>
      <CaughtCall />
    </section>
  );
}
