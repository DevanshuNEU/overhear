# Overhear redesign: product framing, Signal identity, and a self-consistency metric

Date: 2026-09-24
Status: approved (design, via visual brainstorm), pending implementation plan

## Context and goal

Overhear's backend is solid but the frontend reads and looks like a school
project. The goal is to make the presentation match the substance: lead with the
honest "smoke detector for voice agents" thinking, make it look like a shipped
product, and add one real depth proof (self-consistency) that turns "is the judge
reliable?" into a number on screen. Driven by an upcoming Retell interview, so the
bar is "impressive to a voice-AI team," and the framing must stay honest (the
smoke-detector idea: a cheap, tireless first-pass reviewer that shows its own
misses, not an oracle).

Locked via visual brainstorm:
- Direction A: product landing plus console.
- Signal visual identity: amber to red accents on charcoal/near-black, alarm
  inspired, with a pulsing alert motif for low-scoring calls. Dark base retained.
- Vibrant, animated, but tasteful and accessible.

## Goals

- A home page that leads with the story and looks like a real product.
- A new `/how-it-works` page carrying the honest thinking and FAQ.
- An upgraded `/eval` page with the same rigor plus a self-consistency metric.
- A cohesive Signal visual system (color, type, motion) applied across the app.
- A backend self-consistency measurement in the eval harness.

## Non-goals (deferred, and good "what's next" talking points)

- More gold data / harvesting live calls into the gold set.
- Judge model comparison (schema already supports it).
- More agent guardrails or new failure categories.
- Any change to the scoring logic itself (reconciler, rubric weights, dimensions).

## Design

### 1. Visual system (Signal)

Applied app-wide via Tailwind theme tokens and CSS variables.
- **Base:** charcoal / near-black (`#0a0705` to `#16100a`), one step warmer than
  today's flat zinc.
- **Brand accent:** amber `#f59e0b` to red `#ef4444`, used for the wordmark,
  gradient hero, links, and focus states.
- **Score bands keep their meaning** (this is the smoke-detector logic): a good
  call is calm (emerald, quiet), a poor call alarms (amber then red). So retain
  the existing ScoreBadge band colors and add the alarm-red pulse only on
  low-scoring calls and failure chips.
- **Type:** establish a scale (display / h1 / h2 / body / mono for ids and
  numbers). Use the app's existing font stack; add clear weight and size steps.
- **Motion (all respect `prefers-reduced-motion`, which disables them):**
  animated gradient in the hero; count-up on the headline stats; soft glow on
  accent surfaces; a pulsing live dot (call in progress) and a pulsing alarm dot
  (low score); scroll-reveal (fade plus rise) on sections via IntersectionObserver;
  smooth hover and page transitions. CSS-first; a few small client components for
  count-up and scroll-reveal. No heavy animation dependency.

### 2. Home ( `/` )

Top to bottom:
- **Nav:** Overhear wordmark, links to How it works, Judge accuracy, and a
  GitHub link to the repo (`https://github.com/DevanshuNEU/retell`, opens in a new
  tab with `rel="noreferrer"`). This nav is shared across all three pages, so the
  repo link is in the header everywhere.
- **Hero:** headline "A smoke detector for voice agents", one honest subline
  ("It scores every call, and it measures how accurate that scoring actually
  is."), animated gradient, two calls to action: "Talk to the agent" (scrolls to
  the live widget) and a headline accuracy stat that links to `/eval` ("caught N
  of M planted failures").
- **Live demo:** the existing WebCallWidget and TryItCard (personas), restyled.
- **Why you can trust it:** a row of 4 short cards, the condensed honest thinking,
  each linking into `/how-it-works`:
  1. We check facts in code, not with an AI.
  2. We ground the AI in the true state.
  3. We measure the AI against a labeled set.
  4. We show you what it missed.
- **Live calls feed:** the existing scored plus processing calls list, restyled,
  newest first, with the alarm pulse on low scores.
- **Footer:** built by Devanshu, links.

Home stays `force-dynamic` and keeps `ensureDemoData` and `AutoRefresh`.

### 3. How it works ( `/how-it-works`, new )

A static, editorial page (may be `force-static`). Sections:
- **The smoke-detector idea**, in plain words.
- **What it is and why:** the pipeline in a simple diagram (agent -> tools ->
  webhook -> reconciler + judge -> score -> dashboard), objective vs subjective
  split called out.
- **What we did to make it reliable:** push checks into code; ground the judge in
  true state; structured output and an anchored rubric; measure against a gold
  set; show raw counts; the staleness guard.
- **Honest FAQ:** can an AI judge an AI; what are the guarantees; is it really
  reliable (classifier with an operating point; triage vs enforcement); how do you
  judge non-deterministic code (outcomes and invariants, distributions not single
  runs, measure the judge's own variance, which is what self-consistency does).
Content is real prose we write, not lorem. Linked from nav and the home trust cards.

### 4. Judge accuracy ( `/eval`, upgraded )

Keeps everything from the current page (stat tiles with raw counts, per-category
table, per-case gold-vs-predicted diff, the placeholder banner) and gains:
- **A self-consistency panel:** the "wobble" number, how often the judge agrees
  with itself across repeat runs (see Section 5), overall and per subjective
  dimension, framed as "lower wobble = more trustworthy on that dimension."
- **A per-category bar visual** (simple CSS bars, precision/recall), not just a
  table, for scanability. No charting dependency required.
- Restyled in the Signal system.

### 5. Self-consistency metric (backend)

The judge is non-deterministic, so we measure that variance directly.
- Extend the harness with a self-consistency pass: for each gold case, run the
  judge `K` times (default `K = 3`, configurable) and, per subjective dimension,
  compute the agreement rate (share of the `K` runs whose `passed` matches the
  majority verdict). Aggregate to a per-dimension consistency and an overall
  number. Report the raw `K` and case count alongside.
- Add a `selfConsistency` block to the report (per-dimension agreement plus
  overall, with `k` and `n`). The staleness guard is unaffected (it checks the
  rubric snapshot only).
- `npm run eval` gains an optional `--samples K` flag; the stub judge is
  deterministic so its wobble is 0 (a fine, clearly-labeled placeholder), and the
  real run shows real wobble. Cost note: this multiplies real judge calls by `K`,
  which is acceptable for an offline run.
- The `/eval` page reads and displays the `selfConsistency` block.

## Testing

- Visual/behavioral: render tests for the new home sections, the `/how-it-works`
  page (asserts the FAQ questions render), and the `/eval` self-consistency panel,
  in the existing React Testing Library style.
- Self-consistency logic: pure aggregation function unit-tested (agreement across
  K runs, majority handling, K = 1 edge, all-agree and all-disagree cases).
- Harness self-consistency pass tested with a mock judge whose outputs vary across
  calls, asserting the computed wobble.
- Motion: components must no-op under `prefers-reduced-motion`; assert the reduced
  variant renders.
- Regenerate the committed stub `eval/report.json` so it carries the new
  `selfConsistency` block; the freshness guard still passes.
- Keep the full suite, `tsc`, lint, and `next build` green with all three routes.

## File layout

New:
- `src/app/how-it-works/page.tsx` and its section components.
- `src/app/components/CountUp.tsx`, `src/app/components/Reveal.tsx` (small client
  motion helpers), and shared Signal primitives as needed.
- `src/eval/self-consistency.ts` (pure aggregation) and its test.

Changed:
- `src/app/page.tsx` (home restructure), `src/app/globals.css` and Tailwind theme
  (Signal tokens, keyframes), `src/app/components/*` (restyle: ScoreBadge, CallList,
  WebCallWidget, TryItCard, FailureBreakdown), `src/app/eval/EvalReportView.tsx`
  (self-consistency panel, bar visual), `src/eval/harness.ts` and
  `src/eval/report.ts` (selfConsistency), `scripts/run-eval.ts` (`--samples`),
  committed `eval/report.json`.

## Sequencing (implementation phases)

1. Signal design system: tokens, keyframes, type scale, motion helpers
   (CountUp, Reveal), reduced-motion support. Restyle the shared primitives.
2. Self-consistency backend: pure aggregation, harness pass, report field,
   `--samples`, regenerate report.
3. Home redesign: nav, hero, trust cards, restyled demo and calls feed.
4. `/how-it-works` page with real content and the FAQ.
5. `/eval` upgrade: self-consistency panel and per-category bars, restyle.

## Risks and mitigations

- **Motion overuse looks worse, not better.** Mitigation: tasteful defaults,
  reduced-motion support, and animation confined to hero, stat count-ups, reveals,
  and the two status pulses.
- **Self-consistency multiplies real eval cost by K.** Mitigation: default K = 3,
  offline-only, documented; stub run is free.
- **Scope creep into the deferred items.** Mitigation: non-goals are explicit.
