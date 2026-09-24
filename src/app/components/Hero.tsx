// Hero - the product framing at the top of the home page. The animated
// amber-to-red gradient is the Signal identity; the headline stat counts up and
// links to the full accuracy page.
import Link from "next/link";
import { CountUp } from "./CountUp";

export function Hero({ caught, planted, sample }: { caught: number; planted: number; sample: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-zinc-800/70 bg-ink-raised px-6 py-14 sm:px-10 sm:py-20">
      <div
        aria-hidden
        className="animate-gradient-pan pointer-events-none absolute inset-0 opacity-25"
        style={{ background: "linear-gradient(115deg, #f59e0b 0%, #ef4444 45%, transparent 70%)" }}
      />
      <div className="relative flex flex-col gap-5">
        <span className="text-xs uppercase tracking-[0.2em] text-signal-amber">Voice-agent QA</span>
        <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
          A smoke detector for voice agents
        </h1>
        <p className="max-w-xl text-base text-zinc-300 sm:text-lg">
          It scores every call the agent handles, and it measures how accurate that scoring actually is.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <a
            href="#talk"
            className="rounded-md bg-gradient-to-r from-signal-amber to-signal-red px-5 py-2.5 text-sm font-medium text-zinc-950 transition-opacity hover:opacity-90"
          >
            Talk to the agent
          </a>
          <Link
            href="/eval"
            className="rounded-md border border-zinc-700 px-5 py-2.5 text-sm text-zinc-200 transition-colors hover:border-signal-amber/60"
          >
            Caught <CountUp value={caught} className="font-semibold text-signal-amber" /> of {planted} planted failures
            {sample && <span className="text-zinc-500"> (sample)</span>}, see how
          </Link>
        </div>
      </div>
    </section>
  );
}
