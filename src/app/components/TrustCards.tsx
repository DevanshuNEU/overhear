// TrustCards - the honest, plain-words case for why the scores are trustworthy,
// condensed into four points that each link into the full How it works page.
import Link from "next/link";
import { Reveal } from "./Reveal";

const POINTS: { title: string; body: string }[] = [
  {
    title: "We check facts in code, not with an AI.",
    body: "Three of the checks are plain code over the call's action log. Facts, not opinions, so that half is trustworthy by construction.",
  },
  {
    title: "We ground the AI in the true state.",
    body: "The judge is handed the real availability and asked what contradicts it, not asked for a vibe. A checkable claim, not a guess.",
  },
  {
    title: "We measure the AI against a labeled set.",
    body: "We run the judge over calls whose answers we already know and report how often it is right, with the raw counts.",
  },
  {
    title: "We show you what it missed.",
    body: "Every case is on the page, gold versus predicted, in green and red. A tool that hides its misses is not one to trust.",
  },
];

export function TrustCards() {
  return (
    <Reveal>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-100">Why you can trust it</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {POINTS.map((point) => (
            <Link
              key={point.title}
              href="/how-it-works"
              className="group flex flex-col gap-2 rounded-lg border border-zinc-800/80 bg-ink-raised px-4 py-4 transition-colors hover:border-signal-amber/50"
            >
              <span className="text-sm font-medium text-zinc-100 group-hover:text-signal-amber">{point.title}</span>
              <span className="text-sm text-zinc-400">{point.body}</span>
            </Link>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
