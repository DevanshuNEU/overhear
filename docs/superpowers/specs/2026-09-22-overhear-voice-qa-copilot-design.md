# Overhear — an AI QA analyst for voice agents

**Date:** 2026-09-22
**Status:** Design (approved via grilling; pending spec review)
**Author:** Devanshu Chicholikar

## One-liner

A healthcare-scheduling voice agent built on Retell, wrapped in an AI QA
analyst that scores every call against ground truth — the "frontline agent +
QA analyst" loop that production voice AI is racing toward, built on Retell's
API.

## Why this project

A personal project exploring a problem I find genuinely interesting: as voice AI
agents move into production, who watches them? The field is converging on AI
"workers" that act not just as frontline agents but as QA analysts —
continuously monitoring and grading every interaction — because basic automation
needs constant human tuning to stay reliable.

Overhear is a working prototype of that idea: put a real voice agent into
production, then build the QA-analyst worker on top — an AI that grades another
AI against ground truth.

### The audience and the "aha"

The audience is anyone curious whether a voice agent is actually doing its job.
The success criterion is a single 30-second moment they can experience in one
browser tab:

> Talk to the scheduling agent → hang up → watch the QA analyst catch a real
> hallucination against ground truth, live, with a calibrated confidence score.

Everything in scope serves that moment. Everything else is cut.

## Success criteria

1. A reviewer opens a **public live URL** and talks to the agent in-browser (no
   phone, no login).
2. Their call is scored within seconds and appears on the dashboard.
3. The dashboard shows a batch of seeded calls including **visible, caught
   failures** (hallucinated slot, skipped verification, wrong provider, medical
   advice given).
4. The objective failures are demonstrably **checked against the clinic
   database**, not asserted by an LLM grading itself.
5. Shipped with a Loom walkthrough and a short README writeup.

## Scope

**In:**
- Retell voice agent for a clinic: book / reschedule / cancel + identity
  verification as a gate.
- Custom tool endpoints backed by a Postgres clinic database.
- QA analyst: Jev-first judge with a Claude fallback, plus a deterministic
  ground-truth reconciler.
- Full-stack dashboard: call list with scores, transcript viewer with inline QA
  annotations, failure-category breakdown, trend charts.
- Embedded in-browser web-call widget.
- Hybrid demo data: a few genuinely live calls + a seeded synthetic batch with
  planted failures.
- Writeup deliverable: Loom walkthrough + README.

**Out (documented as next steps, not built):**
- The auto-improve engine (clustering failures → drafting prompt/flow edits).
  We ship the *measurement* loop and pitch auto-improvement as the roadmap.
- Real phone numbers (web calls only).
- Auth / multi-tenant (public read-only, all-synthetic PII).
- Insurance/billing and any medical-advice handling by the agent — the agent
  must *decline and escalate* these, which is itself a scored QA behavior.

## Architecture

Three units, each independently testable.

```
Caller ──▶ Retell voice agent ──▶ tool endpoints ──▶ Postgres (clinic)
   (in-browser web call)              │  logs a structured action event
                                      │  per tool call, keyed to call_id
                                      ▼
                          Retell `call_analyzed` webhook
                                      │  (transcript + per-utterance timing
                                      │   + Retell sentiment/summary)
                                      ▼
                             QA Analyst pipeline
                    ┌─────────────────┴──────────────────┐
                    ▼                                     ▼
        Deterministic reconciler                 Jev-first judge
        (pure code vs action log + DB)           (Claude fallback)
        · verify before act                      · subjective Score
        · booking matches real slot              · no-hallucination Boolean
                                                 · failure Choice
                    └─────────────────┬──────────────────┘
                                      ▼
                           weighted composite score
                                      │
                                      ▼
                    Dashboard (Next.js, public read-only)
                    scores · transcripts+annotations · trends
```

### Unit 1 — Voice agent + tool endpoints

- A Retell agent (Response Engine = `retell-llm`) configured via the Retell TS
  SDK, with a warm clinic-receptionist persona ("Northwind Family Clinic").
- Custom tools defined in the LLM's `general_tools[]` (`type: "custom"`), each
  pointing at a Next.js API route: `check_availability`, `verify_patient`,
  `book_appointment`, `reschedule_appointment`, `cancel_appointment`.
- Retell POSTs `{ name, call, args }` to each endpoint (signed with
  `X-Retell-Signature`); endpoints return a string/JSON body (≤15,000 chars).
- **Every tool call writes a structured action event** (`call_id`, tool, args,
  timestamp, DB result) — this is the source of truth for what the agent *did*.

### Unit 2 — QA analyst

Runs on the `call_analyzed` webhook (chosen over `call_ended` because only
`call_analyzed` carries `call_analysis`). Webhook authenticity verified with
`Retell.verify(rawBody, apiKey, signature)` using the **raw** request body
(important for Next.js route handlers — do not re-stringify).

The rubric has six dimensions in two tiers:

| Tier | Dimension | Scored by |
|------|-----------|-----------|
| Objective | Task success | code (action log + DB) |
| Objective | No hallucinated slots/providers | Jev Boolean (DB as state) |
| Objective | Correct tool use | code (action log) |
| Objective | Identity verified before acting | code (timestamp ordering) |
| Subjective | Conversational quality (tone/empathy/dead air) | Jev Score |
| Subjective | Safety & escalation (declined advice / escalated) | Jev Score |

- **Deterministic reconciler** handles the pure-logic checks: `verify_patient`
  precedes any booking mutation; a booking row exists for a real, previously-open
  slot matching the caller's goal. No LLM in this path.
- **Jev-first judge** handles everything requiring reading the transcript:
  subjective Scores, the no-hallucination Boolean (fed the true available slots
  as state), and failure-category Choice for dashboard clustering. Jev returns
  calibrated confidence and cannot answer outside the fixed answer set.
- **Claude fallback** implements the *same* `Judge` interface behind a flag, so
  if the Jev early-access key is unavailable everything still works.
- Claude (generation, not Jev) writes the per-call summary and dashboard
  narrative prose.

Dimension scores roll into a weighted composite per call.

### Unit 3 — Dashboard

Next.js App Router, public read-only. Call list with composite scores; transcript
viewer with inline QA annotations (which utterance triggered which flag);
failure-category breakdown; score trend charts. Includes the embedded
"📞 Talk to the scheduling agent" web-call widget (`retell-client-js-sdk`),
so a reviewer talks to the agent and watches their own call get scored.

## Data model (Postgres, Drizzle)

- `providers` — clinic doctors.
- `appointment_slots` — provider, datetime, status (open/booked). Ground truth
  for availability.
- `patients` — synthetic patient records (name, DOB) for verification. All PII
  fake.
- `appointments` — bookings (patient, slot, status).
- `calls` — one row per Retell call (call_id, transcript, recording_url, Retell
  sentiment/summary, timestamps).
- `action_events` — structured log of every tool call (call_id, tool, args,
  result, ts).
- `qa_scores` — per-call composite + per-dimension scores, judge source
  (jev|claude), confidence, failure categories, LLM-written summary.

## Judge interface

```ts
interface Judge {
  score(input: {
    transcript: TranscriptObject;
    trueSlots: Slot[];          // DB state for the no-hallucination check
    actionEvents: ActionEvent[];
  }): Promise<{
    subjective: { conversationQuality: Score; safetyEscalation: Score };
    noHallucination: Boolean;   // with confidence
    failureCategories: Category[];
  }>;
}
```

Two implementations: `JevJudge` (Vercel AI SDK 7 `experimental_evaluate`, model
`typesafe-ai/jev`) and `ClaudeJudge` (Anthropic structured output). Selected by
env flag; Jev-first, Claude fallback.

## Tech stack & deployment

- **Next.js + TypeScript** (App Router) — dashboard, tool endpoints, webhook.
- **Retell TS SDK** (`retell-sdk`) server-side; `retell-client-js-sdk` in browser.
- **Postgres + Drizzle** on **Railway** (hobby plan already owned).
- App also hosted on **Railway** (one platform, one bill, one live URL).
- **Jev** via Vercel AI SDK 7 (`experimental_evaluate`); **Claude** via the
  Anthropic SDK for fallback judge + report prose.

## Sequencing (ship fast — live by day ~4)

1. **Days 1-2:** clinic DB + tool endpoints + Retell agent talking and booking
   end to end; app skeleton deployed to Railway (live URL exists early).
2. **Days 3-4:** webhook ingestion + deterministic reconciler + Jev judge (Claude
   fallback) scoring calls; one planted failure visible live. **Demoable here.**
3. **Days 5-8:** dashboard (call list, transcript+annotations, category/trend
   charts) + web-call widget embedded.
4. **Days 9-11:** seed synthetic batch with the four planted failures; polish.
5. **Days 12-14:** Loom walkthrough, README writeup, polish.

## Seeded failure catalog (the aha)

Four planted failures, one per relevant dimension, run through the *same* judge:
1. Hallucinated slot (agent offers availability not in DB) → no-hallucination red.
2. Booking without identity verification → verify-before-act red.
3. Wrong-provider booking → correct-tool-use / task-success red.
4. Medical advice given instead of declined → safety & escalation red.

## Risks & mitigations

- **Jev is days old, API experimental, limited early access** — the key may not
  arrive in time; numbers are vendor-sourced. *Mitigation:* Claude fallback behind
  the shared `Judge` interface; the demo never depends on Jev being reachable.
- **Model-id strings / exact `call_analyzed` payload nesting** flagged as
  partly doc-summarized in research. *Mitigation:* confirm against a live payload
  and the create-retell-llm `model` enum before hardcoding.
- **Free-tier budget:** $10 credits, web calls need no phone number (~60-130 min
  of calls). *Mitigation:* rely on seeded synthetic calls for volume; keep live
  calls to a handful.

## References

- `docs/research/retell-api-facts.md` — Retell webhook payloads, tool schema,
  SDK flow, free-tier limits (primary-source, cited).
- `docs/research/jev-tool.md` — Jev identification, primitives, TS SDK, fit
  analysis, caveats (primary-source, cited).
```

