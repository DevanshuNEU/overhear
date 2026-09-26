// TrustCards - the honest, plain-words case for why the scores are trustworthy.
// Four statements, not a sequence, so no numbering: each is a hairline-ruled
// entry that links into the full How it works page.
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
    body: "Every case is on the page, gold versus predicted. A tool that hides its misses is not one to trust.",
  },
];

export function TrustCards() {
  return (
    <Reveal>
      <section className="flex flex-col gap-6">
        <h2 className="font-display text-xl font-semibold tracking-tight">Why you can trust it</h2>
        <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {POINTS.map((point) => (
            <Link key={point.title} href="/how-it-works" className="group flex flex-col gap-2 border-t border-border pt-4">
              <h3 className="text-base font-medium text-foreground transition-colors group-hover:text-alarm-amber">
                {point.title}
              </h3>
              <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">{point.body}</p>
            </Link>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
