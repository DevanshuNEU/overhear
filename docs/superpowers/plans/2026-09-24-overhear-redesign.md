# Overhear Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe Overhear as a polished product (Signal identity, product landing, honest /how-it-works page) and add a self-consistency reliability metric surfaced on /eval.

**Architecture:** A Signal design system (Tailwind v4 CSS tokens + keyframes + small motion helpers) restyles the app; the home page becomes a product landing; a new /how-it-works page carries the honest thinking and FAQ; /eval gains a self-consistency panel fed by a new pure aggregation over K repeat judge runs.

**Tech Stack:** Next.js 16 (App Router), Tailwind v4 (CSS `@theme inline` in globals.css, no tailwind.config.js), TypeScript, Geist fonts, Vitest + React Testing Library. recharts is already a dependency but this plan uses CSS bars, no new charting dep.

**Spec:** `docs/superpowers/specs/2026-09-24-overhear-redesign-design.md`

## Global Constraints

- No em-dashes or en-dashes anywhere (HTML entity arrows allowed). Use a spaced hyphen, comma, or colon.
- Commits authored by Devanshu; NO `Co-Authored-By` trailer; PR body omits the "Generated with Claude Code" line.
- Tailwind v4: theme tokens go in `src/app/globals.css` under `@theme inline` (there is no `tailwind.config.js`). Custom `--color-*` tokens generate `bg-*`/`text-*`/`border-*` utilities.
- Next 16 App Router. Read `node_modules/next/dist/docs/` before using any Next API you are unsure about. Do not remove the AGENTS.md-managed block from any generated file.
- Every animation must respect `prefers-reduced-motion: reduce` (no motion under it) and every animated component must still render its final content statically.
- Score-band colors keep their meaning (emerald good, amber mixed, rose poor). Signal amber `#f59e0b` and red `#ef4444` are the brand accent; the alarm-red pulse appears only on low-scoring calls and failure chips.
- The repo link in the header opens `https://github.com/DevanshuNEU/retell` in a new tab with `rel="noreferrer"`, and the header nav is shared across all three pages.
- Home stays `export const dynamic = "force-dynamic"` and keeps `ensureDemoData(db)` and `<AutoRefresh />`.

## Review Focus

- **`prefers-reduced-motion: reduce`:** every animated component (hero gradient, CountUp, Reveal, pulses) must render static and fully readable, not blank or stuck at 0. Pinned in Tasks 1, 2.
- **JS-disabled / pre-hydration render:** CountUp and Reveal must show their final value/content on first paint (SSR), never 0 or hidden, so a no-JS or slow-hydration viewer sees real content. Pinned in Task 2.
- **`/eval` with a report that has no `selfConsistency` block** (older or real pre-samples report): the page must render without crashing (optional-field guard). Pinned in Task 7.
- **Home still live:** `ensureDemoData` and `AutoRefresh` must remain wired after the restructure, or the processing feed and self-healing data break. Pinned in Task 5.
- **Header repo link security:** external link must set `rel="noreferrer"` and `target="_blank"`. Pinned in Task 1.

---

## Task 1: Signal design system and shared header nav

**Files:**
- Modify: `src/app/globals.css` (Signal tokens, keyframes, motion utilities, reduced-motion)
- Modify: `src/app/layout.tsx` (charcoal background, metadata)
- Create: `src/app/components/SiteNav.tsx`
- Test: `src/app/components/SiteNav.test.tsx`

**Interfaces:**
- Produces: `SiteNav` React component; global utility classes `animate-gradient-pan`, `animate-pulse-alarm`, `animate-reveal`; color utilities `bg-ink`, `bg-ink-raised`, `text-signal-amber`, `text-signal-red`, `border-signal-amber`.

- [ ] **Step 1: Write the failing test** `src/app/components/SiteNav.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteNav } from "./SiteNav";

describe("SiteNav", () => {
  it("renders the wordmark and the three links, with a safe external repo link", () => {
    render(<SiteNav />);
    expect(screen.getByText("Overhear")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /how it works/i })).toHaveAttribute("href", "/how-it-works");
    expect(screen.getByRole("link", { name: /judge accuracy/i })).toHaveAttribute("href", "/eval");
    const repo = screen.getByRole("link", { name: /github/i });
    expect(repo).toHaveAttribute("href", "https://github.com/DevanshuNEU/retell");
    expect(repo).toHaveAttribute("target", "_blank");
    expect(repo).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/components/SiteNav.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Add Signal tokens and motion to `src/app/globals.css`:**

```css
@import "tailwindcss";

@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --color-ink: #0a0705;
  --color-ink-raised: #16100a;
  --color-signal-amber: #f59e0b;
  --color-signal-red: #ef4444;
}

@keyframes gradient-pan { from { background-position: 0% 50%; } to { background-position: 200% 50%; } }
@keyframes pulse-alarm { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
@keyframes reveal-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

.animate-gradient-pan { background-size: 200% 200%; animation: gradient-pan 6s linear infinite alternate; }
.animate-pulse-alarm { animation: pulse-alarm 1.6s ease-in-out infinite; }
.animate-reveal { animation: reveal-rise 0.6s cubic-bezier(0.16, 1, 0.3, 1) both; }

@media (prefers-reduced-motion: reduce) {
  .animate-gradient-pan, .animate-pulse-alarm, .animate-reveal { animation: none !important; }
}
```

- [ ] **Step 4: Update `src/app/layout.tsx`:** change the body class from `bg-zinc-950` to `bg-ink`, and update `metadata.description` to `"An AI QA analyst for voice agents: it scores every call and measures how accurate that scoring is."`. Leave the fonts and the LayoutProps signature unchanged.

- [ ] **Step 5: Write `src/app/components/SiteNav.tsx`:**

```tsx
// Shared header nav across all pages. The GitHub link is external, so it opens
// in a new tab with rel="noreferrer".
import Link from "next/link";

export function SiteNav() {
  return (
    <nav className="flex items-center justify-between border-b border-zinc-800/60 px-6 py-4">
      <Link href="/" className="bg-gradient-to-r from-signal-amber to-signal-red bg-clip-text text-lg font-semibold tracking-tight text-transparent">
        Overhear
      </Link>
      <div className="flex items-center gap-5 text-sm text-zinc-400">
        <Link href="/how-it-works" className="transition-colors hover:text-zinc-100">How it works</Link>
        <Link href="/eval" className="transition-colors hover:text-zinc-100">Judge accuracy</Link>
        <a href="https://github.com/DevanshuNEU/retell" target="_blank" rel="noreferrer" className="transition-colors hover:text-zinc-100">GitHub</a>
      </div>
    </nav>
  );
}
```

- [ ] **Step 6: Run tests + build**

Run: `npx vitest run src/app/components/SiteNav.test.tsx && npm run build`
Expected: PASS; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css src/app/layout.tsx src/app/components/SiteNav.tsx src/app/components/SiteNav.test.tsx
git commit -m "feat(ui): Signal design tokens, motion utilities, and shared header nav"
```

---

## Task 2: Motion helpers (CountUp, Reveal)

**Files:**
- Create: `src/app/components/CountUp.tsx`, `src/app/components/Reveal.tsx`
- Test: `src/app/components/CountUp.test.tsx`, `src/app/components/Reveal.test.tsx`

**Interfaces:**
- Produces: `<CountUp value={number} suffix?={string} className?={string} />` and `<Reveal>{children}</Reveal>`. Both are client components that render their final content on first paint (SSR-safe) and only animate after mount when motion is allowed.

- [ ] **Step 1: Write the failing tests.**

`src/app/components/CountUp.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CountUp } from "./CountUp";

describe("CountUp", () => {
  it("renders the final value immediately (SSR-safe, no stuck 0)", () => {
    render(<CountUp value={94} suffix="%" />);
    expect(screen.getByText(/94%/)).toBeInTheDocument();
  });
});
```

`src/app/components/Reveal.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Reveal } from "./Reveal";

describe("Reveal", () => {
  it("renders its children (visible even before intersection)", () => {
    render(<Reveal><p>hello</p></Reveal>);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/components/CountUp.test.tsx src/app/components/Reveal.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write `src/app/components/CountUp.tsx`:**

```tsx
"use client";

// Counts from 0 up to `value` on mount. Renders the final value on first paint
// (so SSR and no-JS show the real number, never a stuck 0), then animates only
// if the client allows motion.
import { useEffect, useRef, useState } from "react";

export function CountUp({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const [display, setDisplay] = useState(value);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let raf = 0;
    const start = performance.now();
    const duration = 900;
    setDisplay(0);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span ref={ref} className={className}>{display}{suffix}</span>;
}
```

- [ ] **Step 4: Write `src/app/components/Reveal.tsx`:**

```tsx
"use client";

// Fades and rises its children into view when scrolled to. Children are visible
// from first paint (opacity governed by a class that only hides once JS marks it
// pending), so SSR and no-JS always show content. Under reduced motion it is a
// no-op passthrough.
import { useEffect, useRef, useState } from "react";

export function Reveal({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { setShown(true); return; }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setShown(true); io.disconnect(); }
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`${shown ? "animate-reveal" : ""} ${className ?? ""}`}>
      {children}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run src/app/components/CountUp.test.tsx src/app/components/Reveal.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/components/CountUp.tsx src/app/components/Reveal.tsx src/app/components/CountUp.test.tsx src/app/components/Reveal.test.tsx
git commit -m "feat(ui): CountUp and Reveal motion helpers, SSR-safe and reduced-motion aware"
```

---

## Task 3: Self-consistency aggregation (pure)

**Files:**
- Create: `src/eval/self-consistency.ts`
- Test: `src/eval/self-consistency.test.ts`

**Interfaces:**
- Produces:
  - `interface Consistency { perDimension: Record<string, { agreement: number; n: number }>; overall: number; k: number }`
  - `selfConsistency(caseSamples: Record<string, boolean>[][], keys: string[]): Consistency` where `caseSamples[i]` is the array of K judge verdict-maps (dimKey to passed) for gold case i.

- [ ] **Step 1: Write the failing test** `src/eval/self-consistency.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { selfConsistency } from "./self-consistency";

const keys = ["a", "b"];

describe("selfConsistency", () => {
  it("is 1.0 when every repeat agrees", () => {
    const out = selfConsistency([
      [{ a: true, b: false }, { a: true, b: false }, { a: true, b: false }],
    ], keys);
    expect(out.perDimension.a.agreement).toBe(1);
    expect(out.perDimension.b.agreement).toBe(1);
    expect(out.overall).toBe(1);
    expect(out.k).toBe(3);
  });

  it("uses the majority share per case (2 of 3 agree = 0.667)", () => {
    const out = selfConsistency([
      [{ a: true }, { a: true }, { a: false }],
    ], ["a"]);
    expect(out.perDimension.a.agreement).toBeCloseTo(2 / 3);
    expect(out.perDimension.a.n).toBe(1);
  });

  it("scores a clean 1-1 split as 0.5 and averages across cases", () => {
    const out = selfConsistency([
      [{ a: true }, { a: false }],   // 0.5
      [{ a: true }, { a: true }],    // 1.0
    ], ["a"]);
    expect(out.perDimension.a.agreement).toBeCloseTo(0.75);
  });

  it("returns 0 for empty input without NaN", () => {
    const out = selfConsistency([], ["a"]);
    expect(out.perDimension.a.agreement).toBe(0);
    expect(out.overall).toBe(0);
    expect(out.k).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/eval/self-consistency.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/eval/self-consistency.ts`:**

```ts
// Measures how much the (non-deterministic) judge disagrees with itself across
// K repeat runs of the same call. Per case and dimension, agreement is the share
// of the K verdicts that fall on the majority side (max(trues, falses) / K); this
// handles ties cleanly (a 1-1 split is 0.5). Averaged across cases per dimension,
// then across dimensions for the overall number. Higher is more trustworthy.
export interface Consistency {
  perDimension: Record<string, { agreement: number; n: number }>;
  overall: number;
  k: number;
}

export function selfConsistency(caseSamples: Record<string, boolean>[][], keys: string[]): Consistency {
  const perDimension: Record<string, { agreement: number; n: number }> = {};
  for (const key of keys) {
    let sum = 0;
    let n = 0;
    for (const samples of caseSamples) {
      if (samples.length === 0) continue;
      const trues = samples.filter((s) => s[key] === true).length;
      const falses = samples.filter((s) => s[key] === false).length;
      const total = trues + falses;
      if (total === 0) continue;
      sum += Math.max(trues, falses) / total;
      n += 1;
    }
    perDimension[key] = { agreement: n === 0 ? 0 : sum / n, n };
  }
  const agreements = keys.map((key) => perDimension[key].agreement);
  const overall = agreements.length === 0 ? 0 : agreements.reduce((a, b) => a + b, 0) / agreements.length;
  const k = caseSamples[0]?.length ?? 0;
  return { perDimension, overall, k };
}
```

- [ ] **Step 4: Run test to verify pass**

Run: `npx vitest run src/eval/self-consistency.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/eval/self-consistency.ts src/eval/self-consistency.test.ts
git commit -m "feat(eval): pure self-consistency aggregation over K repeat judge runs"
```

---

## Task 4: Wire self-consistency through the harness, report, and script

**Files:**
- Modify: `src/eval/report.ts` (add optional `selfConsistency` to `EvalRun.metrics`)
- Modify: `src/eval/harness.ts` (`runEval` gains `{ samples }` option; compute selfConsistency)
- Modify: `src/eval/harness.test.ts` (add a mock-judge test for the samples path)
- Modify: `scripts/run-eval.ts` (`--samples K` flag)
- Regenerate: `eval/report.json` (via `npm run eval -- --stub --samples 3`)

**Interfaces:**
- Consumes: `selfConsistency`, `Consistency` from Task 3; `SUBJECTIVE_DIMENSIONS` from `@/judge/dimensions`.
- Produces: `runEval(gold, judge, opts?: { samples?: number })`; `EvalRun.metrics.selfConsistency?: Consistency`.

- [ ] **Step 1: Write the failing test** in `src/eval/harness.test.ts` (add a case; the mock judge alternates a dimension's verdict across calls):

```ts
it("computes self-consistency across repeat judge runs when samples > 1", async () => {
  let call = 0;
  const flakyJudge: Judge = {
    source: "claude",
    async score() {
      call += 1;
      const passed = call % 2 === 1; // alternates true/false across repeats
      const dim = (key: string, p: boolean) => ({ key, tier: "subjective" as const, score: p ? 1 : 0, passed: p, confidence: null, rationale: "" });
      return {
        no_hallucination: dim("no_hallucination", true) as never,
        conversational_quality: dim("conversational_quality", true) as never,
        safety_escalation: dim("safety_escalation", true) as never,
        confirmed_before_acting: dim("confirmed_before_acting", passed) as never,
        failureCategories: [],
      };
    },
  };
  const gold = [goldCase({ id: "s1", labelSource: "human", lines: [{ role: "user", content: "hi" }], failures: [], band: "clean" })];
  const run = await runEval(gold, flakyJudge, { samples: 3 });
  expect(run.metrics.selfConsistency?.k).toBe(3);
  // confirmed_before_acting alternated over 3 calls (T,F,T) -> majority share 2/3
  expect(run.metrics.selfConsistency?.perDimension.confirmed_before_acting.agreement).toBeCloseTo(2 / 3);
  // a stable dimension is 1.0
  expect(run.metrics.selfConsistency?.perDimension.no_hallucination.agreement).toBe(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/eval/harness.test.ts`
Expected: FAIL (`selfConsistency` undefined / no samples option).

- [ ] **Step 3: Add the report field** in `src/eval/report.ts`, extend `EvalRun.metrics`:

```ts
  metrics: SourceMetrics & {
    dimensionAgreement: Record<string, { agreement: number; matches: number; n: number }>;
    byLabelSource: { objective: SourceMetrics; human: SourceMetrics };
    selfConsistency?: import("./self-consistency").Consistency;
  };
```

- [ ] **Step 4: Update `runEval`** in `src/eval/harness.ts`. Add the option and, when `samples > 1`, collect K subjective-verdict maps per case and compute selfConsistency. Import `selfConsistency` and `SUBJECTIVE_DIMENSIONS`. Sketch:

```ts
import { selfConsistency } from "./self-consistency";
import { SUBJECTIVE_DIMENSIONS } from "@/judge/dimensions";

export async function runEval(gold: GoldCase[], judge: Judge, opts: { samples?: number } = {}): Promise<EvalRun> {
  const samples = Math.max(1, opts.samples ?? 1);
  const subjectiveKeys = SUBJECTIVE_DIMENSIONS.map((d) => d.key);
  const caseSamples: Record<string, boolean>[][] = [];
  // ... existing per-case scoring loop, using the FIRST judge result for the score ...
  // Inside the loop, after the primary `jr = await judge.score(...)`, seed the sample set:
  //   const perCase: Record<string, boolean>[] = [Object.fromEntries(subjectiveKeys.map((k) => [k, (jr as any)[k].passed]))];
  //   for (let s = 1; s < samples; s++) { const extra = await judge.score(c.context); perCase.push(Object.fromEntries(subjectiveKeys.map((k) => [k, (extra as any)[k].passed]))); }
  //   caseSamples.push(perCase);
  // ... then in the returned metrics object add:
  //   ...(samples > 1 ? { selfConsistency: selfConsistency(caseSamples, subjectiveKeys) } : {}),
}
```

Keep the existing dimensions/composite/cases/metrics logic exactly as is; only add the sampling collection and the optional `selfConsistency` field. When `samples === 1`, behavior and output are unchanged (no `selfConsistency` key).

- [ ] **Step 5: Run the harness test to verify pass**

Run: `npx vitest run src/eval/harness.test.ts`
Expected: PASS (existing tests unchanged, new samples test passes).

- [ ] **Step 6: Add `--samples` to `scripts/run-eval.ts`:** parse an integer `--samples N` from argv (default 1) and pass `{ samples: N }` to `runEval`. Update the summary log to include the self-consistency overall when present.

- [ ] **Step 7: Regenerate the committed report**

Run: `npm run eval -- --stub --samples 3`
Expected: `eval/report.json` now has `runs[0].metrics.selfConsistency` with `k: 3`; since the stub judge is deterministic, every agreement is 1.0 (a fine, clearly-labeled placeholder). Confirm the freshness guard still passes: `npx vitest run src/eval/report-freshness.test.ts`.

- [ ] **Step 8: Run full suite + commit**

Run: `npm test && npx tsc --noEmit`

```bash
git add src/eval/report.ts src/eval/harness.ts src/eval/harness.test.ts scripts/run-eval.ts eval/report.json
git commit -m "feat(eval): measure and report judge self-consistency across K repeat runs"
```

---

## Task 5: Home page redesign

**Files:**
- Modify: `src/app/page.tsx` (restructure into a product landing)
- Create: `src/app/components/Hero.tsx`, `src/app/components/TrustCards.tsx`
- Modify (restyle only): `src/app/components/ScoreBadge.tsx`, `CallList.tsx`, `WebCallWidget.tsx`, `TryItCard.tsx`, `FailureBreakdown.tsx`
- Test: `src/app/components/TrustCards.test.tsx`, and update `src/app/page.tsx` consumers if needed

**Interfaces:**
- Consumes: `SiteNav`, `CountUp`, `Reveal` (Tasks 1, 2), the committed report for the headline stat, existing `listCalls`/`failureBreakdown`/`ensureDemoData`.

- [ ] **Step 1: Write the failing test** `src/app/components/TrustCards.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrustCards } from "./TrustCards";

describe("TrustCards", () => {
  it("renders the four honest trust points", () => {
    render(<TrustCards />);
    expect(screen.getByText(/check facts in code/i)).toBeInTheDocument();
    expect(screen.getByText(/ground the ai in the true state/i)).toBeInTheDocument();
    expect(screen.getByText(/measure the ai against a labeled set/i)).toBeInTheDocument();
    expect(screen.getByText(/show you what it missed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/components/TrustCards.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write `TrustCards.tsx`** as a presentational grid of the four points, each a card (`bg-ink-raised`, border, hover) with a short title and one line, each linking to `/how-it-works`. The four titles verbatim: "We check facts in code, not with an AI.", "We ground the AI in the true state.", "We measure the AI against a labeled set.", "We show you what it missed." Wrap the grid in `<Reveal>`.

- [ ] **Step 4: Write `Hero.tsx`** (server component is fine; CountUp/Reveal are the only client bits): a full-bleed section with an `animate-gradient-pan` background using the amber-to-red gradient, the headline "A smoke detector for voice agents", the subline "It scores every call, and it measures how accurate that scoring actually is.", and two CTAs: an anchor "Talk to the agent" linking to `#talk`, and a `<Link href="/eval">` showing the headline stat via `<CountUp value={caught} />` of `total` planted failures. Accept the computed `caught`/`total` as props from the page.

- [ ] **Step 5: Restructure `src/app/page.tsx`:** render `<SiteNav />`, `<Hero caught={..} total={..} />`, a `#talk` section wrapping the existing `<WebCallWidget />` and `<TryItCard />`, `<TrustCards />`, the headline stat (reuse the existing `evalHeadline` logic), then `<FailureBreakdown />` and `<CallList />` inside `<Reveal>` blocks. KEEP `export const dynamic = "force-dynamic"`, the `await ensureDemoData(db)` call, and `<AutoRefresh />`. Keep the existing report import for the stat.

- [ ] **Step 6: Restyle the shared components** (visual only, do not change props or behavior): apply Signal surfaces (`bg-ink-raised`, warmer borders), and on `ScoreBadge`/`CallList` add the `animate-pulse-alarm` class to the badge/row only when the composite is in the poor band (`< 50`), so low-scoring calls visibly alarm. Do not change ScoreBadge's band thresholds or colors.

- [ ] **Step 7: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS; `/` builds; existing page/component tests still green (update any snapshot/text assertions the restyle legitimately changed, but do not weaken behavioral assertions).

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx src/app/components
git commit -m "feat(ui): product-landing home with hero, trust cards, and alarm-pulse low scores"
```

---

## Task 6: /how-it-works page

**Files:**
- Create: `src/app/how-it-works/page.tsx` and section components under `src/app/how-it-works/`
- Test: `src/app/how-it-works/HowItWorks.test.tsx` (or a page-level render test)

**Interfaces:**
- Consumes: `SiteNav`, `Reveal`.

- [ ] **Step 1: Write the failing test** asserting the honest FAQ questions render. `src/app/how-it-works/HowItWorks.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HowItWorks from "./page";

describe("/how-it-works", () => {
  it("answers the four honest questions", () => {
    render(<HowItWorks />);
    expect(screen.getByText(/can an ai judge an ai/i)).toBeInTheDocument();
    expect(screen.getByText(/what are the guarantees/i)).toBeInTheDocument();
    expect(screen.getByText(/is it really reliable/i)).toBeInTheDocument();
    expect(screen.getByText(/non-deterministic/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/how-it-works/HowItWorks.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Write the page** `src/app/how-it-works/page.tsx` (may be `export const dynamic = "force-static"`), rendering `<SiteNav />` then editorial sections wrapped in `<Reveal>`:
  - The smoke-detector idea, in plain words (a cheap, tireless first-pass reviewer that flags risky calls and shows its own misses, not an oracle).
  - What it is and why, with a simple CSS/flex pipeline diagram: agent -> tools -> webhook -> reconciler (code, deterministic) + judge (LLM) -> score -> dashboard, calling out the objective vs subjective split.
  - What we did to make it reliable: push checks into code; ground the judge in true state; structured output and an anchored rubric; measure against a gold set; show raw counts; self-consistency; the staleness guard.
  - An FAQ with these exact question headings and honest answers drawn from the spec: "Can an AI judge an AI?", "What are the guarantees?", "Is it really reliable?", "How do you judge non-deterministic code?"
  Write the answers as real prose (2 to 4 sentences each), grounded in what the app actually does. No lorem, no invented capabilities.

- [ ] **Step 4: Run test + build**

Run: `npx vitest run src/app/how-it-works/HowItWorks.test.tsx && npm run build`
Expected: PASS; `/how-it-works` in the route list.

- [ ] **Step 5: Commit**

```bash
git add src/app/how-it-works
git commit -m "feat(ui): how-it-works page with the honest thinking and FAQ"
```

---

## Task 7: /eval upgrade (self-consistency panel + bars)

**Files:**
- Modify: `src/app/eval/EvalReportView.tsx` (self-consistency panel, per-category bars, Signal restyle, SiteNav)
- Modify: `src/app/eval/page.tsx` (render SiteNav, Signal container)
- Modify: `src/app/eval/EvalReportView.test.tsx` (assert the panel; assert graceful render without the block)

**Interfaces:**
- Consumes: `EvalReport` with optional `metrics.selfConsistency` (Task 4), `SiteNav`.

- [ ] **Step 1: Write the failing tests** in `src/app/eval/EvalReportView.test.tsx`: add the `selfConsistency` block to the sample report and assert a "self-consistency" or "agreement" label renders with the overall value; add a second test that a report WITHOUT `selfConsistency` still renders (no crash, headline stats present).

```tsx
it("shows the self-consistency panel when present", () => {
  const withSc = structuredClone(sample);
  withSc.runs[0].metrics.selfConsistency = { perDimension: { no_hallucination: { agreement: 1, n: 2 } }, overall: 0.95, k: 3 };
  render(<EvalReportView report={withSc} />);
  expect(screen.getByText(/self-consistency|agreement/i)).toBeInTheDocument();
});

it("renders without a self-consistency block", () => {
  render(<EvalReportView report={sample} />); // sample has no selfConsistency
  expect(screen.getByText("g1")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify the new panel test fails**

Run: `npx vitest run src/app/eval/EvalReportView.test.tsx`
Expected: FAIL on the panel test.

- [ ] **Step 3: Add the self-consistency panel** to `EvalReportView.tsx`, guarded by `run.metrics.selfConsistency`: show the overall as a percent with `k` and framing ("how often the judge agrees with itself across {k} runs; higher is more trustworthy"), and a small per-dimension list. Place it near the stat cards.

- [ ] **Step 4: Add per-category bars:** next to (or replacing) the numbers in the category table, render a simple CSS bar for precision and recall (`div` with width = percent, `bg-signal-amber`). Keep the raw counts. No charting library.

- [ ] **Step 5: Restyle** `EvalReportView.tsx` and `src/app/eval/page.tsx` to the Signal system and render `<SiteNav />` at the top of the page (matching home). Keep the placeholder banner and all existing content.

- [ ] **Step 6: Run tests + build**

Run: `npm test && npm run build`
Expected: PASS; `/eval` builds and both new tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/eval
git commit -m "feat(ui): eval self-consistency panel, per-category bars, and Signal restyle"
```

---

## Final verification

- [ ] `npm test && npm run lint && npm run build`, all green, routes `/`, `/how-it-works`, `/eval` all present.
- [ ] Manually confirm (or via a reduced-motion test) that animations no-op under `prefers-reduced-motion`.
- [ ] Open the PR against `master`.

## Self-review notes (author)

- Spec coverage: Signal system (Task 1), motion (Task 2), self-consistency logic + wiring (Tasks 3, 4), home landing (Task 5), how-it-works + FAQ (Task 6), eval upgrade (Task 7), repo link in shared nav (Task 1). All spec sections map to a task.
- Type consistency: `Consistency`/`selfConsistency` (Task 3) are consumed with the same shape in Task 4 and rendered in Task 7; `SiteNav`, `CountUp`, `Reveal` names are stable across tasks.
- Review Focus: reduced-motion (Tasks 1, 2, final), SSR/no-JS content (Task 2), optional selfConsistency render guard (Task 7), home still force-dynamic with ensureDemoData/AutoRefresh (Task 5), external link rel (Task 1).
