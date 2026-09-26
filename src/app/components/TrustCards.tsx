// TrustCards - the honest, plain-words case for why the scores are trustworthy,
// condensed into four points that each link into the full How it works page.
import Link from "next/link";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Reveal } from "./Reveal";

const POINTS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "We check facts in code, not with an AI.",
    body: "Three of the checks are plain code over the call's action log. Facts, not opinions, so that half is trustworthy by construction.",
  },
  {
    n: "02",
    title: "We ground the AI in the true state.",
    body: "The judge is handed the real availability and asked what contradicts it, not asked for a vibe. A checkable claim, not a guess.",
  },
  {
    n: "03",
    title: "We measure the AI against a labeled set.",
    body: "We run the judge over calls whose answers we already know and report how often it is right, with the raw counts.",
  },
  {
    n: "04",
    title: "We show you what it missed.",
    body: "Every case is on the page, gold versus predicted, in green and red. A tool that hides its misses is not one to trust.",
  },
];

export function TrustCards() {
  return (
    <Reveal>
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Why you can trust it</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {POINTS.map((point) => (
            <Link key={point.title} href="/how-it-works" className="group">
              <Card className="h-full gap-2 py-4 transition-colors group-hover:border-signal-amber/50">
                <CardContent className="flex flex-col gap-2 px-4">
                  <span className="font-mono text-xs text-signal-amber">{point.n}</span>
                  <CardTitle className="text-sm group-hover:text-signal-amber">{point.title}</CardTitle>
                  <p className="text-sm text-muted-foreground">{point.body}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
