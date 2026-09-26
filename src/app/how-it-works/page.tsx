// How it works - the honest thinking behind Overhear, in plain words. Static
// content, no data fetching.
import { SiteNav } from "../components/SiteNav";
import { Reveal } from "../components/Reveal";

export const dynamic = "force-static";

const PIPELINE = ["Voice agent", "Tools", "Webhook", "Reconciler (code) + Judge (LLM)", "Score", "Dashboard"];

const RELIABILITY = [
  "Push checks into code. Whatever a fact-check can settle, code settles. The LLM never grades what the action log already proves.",
  "Ground the judge in the true state. It is handed real availability and asked what contradicts it, not asked for an opinion.",
  "Structured output and an anchored rubric. The model reports into a fixed schema against explicit level definitions, so it interprets less.",
  "Measure against a gold set. We run the judge over calls whose answers we know and report precision and recall, with raw counts.",
  "Self-consistency. We run the judge several times on the same call and measure how much it wobbles, so a shaky dimension is visible.",
  "A staleness guard. A committed accuracy report that no longer matches the code fails the build, so a stale number can never be shown.",
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Can an AI judge an AI?",
    a: "Not blindly, and we do not pretend otherwise. We shrink what the AI has to judge (three of the checks are plain code), ground the rest in true state, and then measure the judge against answers we already know. It is not trust me, it is here is how often it was right.",
  },
  {
    q: "What are the guarantees?",
    a: "On the code checks, hard guarantees: they cannot hallucinate a booking. On the AI checks, statistical ones: an error rate measured on a labeled set, the way a medical test has a sensitivity and a specificity. There is no absolute guarantee on unseen input, from any AI or any human, and anyone who claims one is bluffing.",
  },
  {
    q: "Is it really reliable?",
    a: "Reliability is not a property of the judge alone, it is the judge paired with the decision. As a smoke detector, flagging the riskiest calls for a human to review, it is reliable enough to be worth far more than humans sampling one call in a hundred. As an automatic gate that fails an agent on its own, the bar is higher and a human stays on the loop. It is a classifier with an operating point, not an oracle.",
  },
  {
    q: "How do you judge non-deterministic code?",
    a: "You stop checking exact outputs and check outcomes and invariants instead: not did it say these words, but did it ever offer a slot that does not exist, measured as a rate over many calls rather than one. And the judge is non-deterministic too, so we measure its own variance directly with self-consistency and pin what we can. The shift is from proving to measuring, from one run to a distribution.",
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Reveal>
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {children}
      </section>
    </Reveal>
  );
}

export default function HowItWorks() {
  return (
    <div className="min-h-full bg-background">
      <SiteNav />
      <main className="mx-auto flex max-w-3xl flex-col gap-12 px-6 py-12">
        <header className="flex flex-col gap-3">
          <span className="text-xs uppercase tracking-[0.2em] text-alarm-amber">The honest version</span>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">How Overhear works, and why to trust it</h1>
          <p className="text-base text-muted-foreground">
            Overhear is a smoke detector for voice agents: a cheap, tireless first-pass reviewer that scores every call,
            flags the risky ones for a human, and shows its own misses. It is not an oracle, and it is built to be honest
            about that.
          </p>
        </header>

        <Section title="What it is, and the pipeline">
          <p className="text-sm text-muted-foreground">
            A real Retell voice agent handles scheduling calls. Each call flows through tools and a webhook into two kinds
            of scoring: objective checks in code, and subjective checks by an LLM judge. The split is the whole point, the
            objective half is trustworthy by construction.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {PIPELINE.map((step, i) => (
              <span key={step} className="flex items-center gap-2">
                <span className="rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">{step}</span>
                {i < PIPELINE.length - 1 && <span className="text-alarm-amber">&rarr;</span>}
              </span>
            ))}
          </div>
        </Section>

        <Section title="What we did to make it reliable">
          <ul className="flex flex-col gap-2">
            {RELIABILITY.map((point) => (
              <li key={point} className="flex gap-2 text-sm text-muted-foreground">
                <span className="text-alarm-amber">-</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Honest FAQ">
          <div className="flex flex-col gap-5">
            {FAQ.map((item) => (
              <div key={item.q} className="flex flex-col gap-1.5 rounded-lg border border-border/80 bg-card px-4 py-4">
                <h3 className="text-sm font-medium text-foreground">{item.q}</h3>
                <p className="text-sm text-muted-foreground">{item.a}</p>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </div>
  );
}
