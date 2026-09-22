# Overhear

**An AI QA analyst for voice agents.**

Overhear runs a healthcare-scheduling voice agent on [Retell](https://www.retellai.com/), then grades every call it takes against the clinic's real database - catching hallucinated appointment slots, skipped identity checks, wrong-provider bookings, and out-of-scope medical questions automatically.

The premise: as voice AI agents move into production, someone has to watch them. Overhear is a small, working take on the idea of an AI worker that grades other AI workers - a frontline agent plus a QA analyst that scores each interaction against ground truth, not vibes.

> A personal project built to explore voice-AI quality assurance. Not affiliated with Retell.

## How it works

```
Caller ─▶ Retell voice agent ─▶ tool endpoints ─▶ Postgres (clinic)
  (browser web call)                 │  each tool call logs a structured
                                     │  action event, keyed to the call id
                                     ▼
                       Retell `call_analyzed` webhook
                       (transcript + per-utterance timing + sentiment)
                                     ▼
                            QA analyst pipeline
                 ┌───────────────────┴────────────────────┐
                 ▼                                          ▼
     Deterministic reconciler                      Jev-first judge
     (pure code vs action log + DB)                (Claude fallback)
     · verified before acting?                     · tone / empathy
     · booked a real, open slot?                   · safety & escalation
     · correct tool use?                           · hallucinated a slot?
                 └───────────────────┬────────────────────┘
                                     ▼
                     weighted composite score per call
                                     ▼
                Dashboard - scores, annotated transcripts, trends
```

Two design choices make the scoring trustworthy rather than hand-wavy:

1. **Ground-truth checks run in code, not an LLM.** Whether the agent booked a real open slot, verified the patient before acting, and used the right tool is decided by reconciling its *logged actions* against the database. The model never grades its own work on these.
2. **A calibrated judge handles the rest.** Tone, safety/escalation, and "did it invent availability?" go to [Jev](docs/research/jev-tool.md) - a structured-decision model that returns calibrated confidence and can't answer outside a fixed set - with a **Claude fallback behind the same interface**, so the system never depends on a single provider being reachable.

## The QA rubric

Every call is scored on six dimensions across two tiers, rolled into a weighted composite:

| Tier | Dimension | Scored by |
|------|-----------|-----------|
| Objective | Task success | code (action log + DB) |
| Objective | No hallucinated slots | judge, checked against DB state |
| Objective | Correct tool use | code (action log) |
| Objective | Identity verified before acting | code (event ordering) |
| Subjective | Conversational quality | judge |
| Subjective | Safety & escalation | judge |

## Tech

- **Next.js + TypeScript** (App Router) - dashboard, tool endpoints, webhook
- **Retell** - the voice agent (server + browser SDKs)
- **Jev** (structured-decision judge) with an **Anthropic Claude** fallback and narration
- **Postgres + Drizzle** - clinic data + call scores (PGlite for hermetic tests)
- **Vitest** - unit + integration tests
- **GitHub Actions** - lint, test, and build on every PR

## Status

Built in reviewed phases, each behind a green-CI pull request.

| Phase | Scope | State |
|-------|-------|-------|
| 1 | Scaffold, CI, database schema, domain model & rubric | ✅ Done |
| 2 | Clinic service (atomic booking) + Retell tool endpoints | ✅ Done |
| 3 | Agent provisioning + web-call token + webhook intake | ✅ Done |
| 4 | QA pipeline - reconciler, Jev/Claude judge, narrator | ⏳ In progress |
| 5 | Dashboard - call list, annotated transcripts, trends, in-browser call widget | ⏳ Planned |
| 6 | Seed data with planted failures + deployment | ⏳ Planned |

## Getting started

Prerequisites: Node 20+, Docker (for local Postgres).

```bash
# 1. Install
npm install

# 2. Configure - copy the example and fill in keys
cp .env.example .env

# 3. Start Postgres and apply migrations
docker compose up -d
npm run db:generate   # regenerate migrations if the schema changed
npm run db:migrate

# 4. Run
npm run dev           # http://localhost:3000
npm test              # run the test suite
npm run lint
npm run build
```

Provisioning the live Retell agent (`npm run provision:agent`) needs a Retell API key and a publicly reachable `APP_URL` for its tool + webhook callbacks; it's a deploy-time step.

### Environment

See [`.env.example`](.env.example). Keys: `DATABASE_URL`, `RETELL_API_KEY`, `ANTHROPIC_API_KEY`, `APP_URL` (required); `JEV_API_KEY` (optional - falls back to Claude); `JUDGE_PROVIDER` (`jev` \| `claude`, default `jev`); `RETELL_AGENT_ID` (set after provisioning).

## Repo layout

```
src/
  lib/env.ts              # Zod-validated, lazily-loaded env
  db/                     # Drizzle schema, client, PGlite test harness
  domain/                 # shared types + rubric scoring
  clinic/                 # booking service with action-event logging
  retell/                 # signature verification + agent/LLM config
  app/api/tools/          # Retell custom-function endpoints
  app/api/web-call/       # browser web-call token
  app/api/webhooks/retell # verified call_analyzed intake
scripts/provision-agent.ts
docs/                     # design doc + primary-source research
```

## Design & research

- [`docs/design.md`](docs/design.md) - the full design: architecture, rubric, judge interface, data model, risks.
- [`docs/research/retell-api-facts.md`](docs/research/retell-api-facts.md) - cited notes on Retell's webhooks, tool schema, and SDK.
- [`docs/research/jev-tool.md`](docs/research/jev-tool.md) - what Jev is and how it fits as the judge.
