# Overhear

An AI QA analyst for voice agents.

Overhear runs a healthcare-scheduling voice agent on [Retell](https://www.retellai.com/), then grades every call it takes against the clinic's real database. It catches hallucinated appointment slots, skipped identity checks, wrong-provider bookings, and out-of-scope medical questions on its own.

As voice AI agents move into production, someone has to watch them. Overhear is a small working prototype of one answer: an AI worker that grades other AI workers. A frontline agent takes the call, and a QA analyst scores it against ground truth rather than against a model's opinion.

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
     verified before acting?                       tone / empathy
     booked a real, open slot?                     safety / escalation
     correct tool use?                             hallucinated a slot?
                 └───────────────────┬────────────────────┘
                                     ▼
                     weighted composite score per call
                                     ▼
             Dashboard: scores, annotated transcripts, trends
```

Two design choices keep the scoring honest.

1. Ground-truth checks run in code, not in an LLM. Whether the agent booked a real open slot, verified the patient before acting, and used the right tool is decided by reconciling its logged actions against the database. The model never grades its own work on these.
2. A calibrated judge handles the rest. Tone, safety and escalation, and "did it invent availability?" go to [Jev](docs/research/jev-tool.md), a structured-decision model that returns calibrated confidence and cannot answer outside a fixed set. A Claude judge sits behind the same interface as a fallback, so the system never depends on one provider being reachable.

## The QA rubric

Every call is scored on six dimensions across two tiers, then rolled into a weighted composite.

| Tier | Dimension | Scored by |
|------|-----------|-----------|
| Objective | Task success | code (action log + DB) |
| Objective | No hallucinated slots | judge, checked against DB state |
| Objective | Correct tool use | code (action log) |
| Objective | Identity verified before acting | code (event ordering) |
| Subjective | Conversational quality | judge |
| Subjective | Safety and escalation | judge |

## Tech

- Next.js and TypeScript (App Router) for the dashboard, tool endpoints, and webhook
- Retell for the voice agent, via its server and browser SDKs
- Jev as the structured-decision judge, with Anthropic Claude as the fallback and for narration
- Postgres with Drizzle for clinic data and call scores, and PGlite for hermetic tests
- Vitest for unit and integration tests
- GitHub Actions to lint, test, and build every pull request

## Status

Built in reviewed phases, each behind a pull request with green CI.

| Phase | Scope | State |
|-------|-------|-------|
| 1 | Scaffold, CI, database schema, domain model and rubric | Done |
| 2 | Clinic service with atomic booking, plus Retell tool endpoints | Done |
| 3 | Agent provisioning, web-call token, and webhook intake | Done |
| 4 | QA pipeline: reconciler, Jev/Claude judge, narrator | Done |
| 5 | Dashboard: call list, annotated transcripts, trends, in-browser call widget | Planned |
| 6 | Seed data with planted failures, plus deployment | Planned |

## Getting started

You need Node 20 or newer and Docker for the local Postgres.

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env file and fill in your keys
cp .env.example .env

# 3. Start Postgres and apply migrations
docker compose up -d
npm run db:generate   # regenerate migrations only if the schema changed
npm run db:migrate

# 4. Run and check
npm run dev           # http://localhost:3000
npm test              # run the test suite
npm run lint
npm run build
```

Provisioning the live Retell agent with `npm run provision:agent` needs a Retell API key and a publicly reachable `APP_URL` for its tool and webhook callbacks, so it is a deploy-time step.

### Environment

Copy [`.env.example`](.env.example) and set these keys.

- `DATABASE_URL`, `RETELL_API_KEY`, `ANTHROPIC_API_KEY`, `APP_URL` are required.
- `JEV_API_KEY` is optional. Without it, the judge runs on Claude.
- `JUDGE_PROVIDER` is `jev` or `claude`, and defaults to `jev`.
- `RETELL_AGENT_ID` is set after you provision the agent.

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

## Design and research

- [`docs/design.md`](docs/design.md) is the full design: architecture, rubric, judge interface, data model, and risks.
- [`docs/research/retell-api-facts.md`](docs/research/retell-api-facts.md) holds cited notes on Retell's webhooks, tool schema, and SDK.
- [`docs/research/jev-tool.md`](docs/research/jev-tool.md) explains what Jev is and how it fits as the judge.
