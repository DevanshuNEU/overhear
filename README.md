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
| 5 | Dashboard: call list, annotated transcripts, trends, in-browser call widget | Done |
| 6 | Seed data with planted failures, plus deployment | Done |

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

## Deploy

Overhear deploys to [Railway](https://railway.com/) as a single web service plus a Postgres plugin. `railway.json` at the repo root configures the build and deploy steps, so Railway's Nixpacks builder needs no extra setup:

- Build: `npm run build`
- Pre-deploy (runs once, before the new container starts serving traffic): `npm run db:migrate:deploy`, which runs `drizzle-kit migrate` against `DATABASE_URL`
- Start: `npm run start`

Because migrations run in the pre-deploy step, every deploy applies pending schema changes before the app comes up. There is no separate migration step to remember.

### Set up the Railway project

1. Create a new Railway project and link this repo as a service.
2. Add a Postgres plugin to the project. Railway sets `DATABASE_URL` on the web service automatically.
3. Set these environment variables on the web service:
   - `RETELL_API_KEY`
   - `ANTHROPIC_API_KEY`
   - `APP_URL`, the Railway-issued public URL for the service (for example `https://overhear-production.up.railway.app`)
   - `JUDGE_PROVIDER`, `jev` or `claude`
   - `JEV_API_KEY`, optional; leave unset to run the judge on Claude
   - `RETELL_AGENT_ID` stays unset for the first deploy. You add it after provisioning the agent below.
4. Deploy. Railway builds the app, runs the pre-deploy migration, then starts it.

### Go-live runbook

1. Deploy the project as above and note the public `APP_URL`.
2. Locally, with `APP_URL` set to that live URL, run `npm run provision:agent`. This creates the Retell agent with its tool and webhook URLs pointed at production, and prints a `RETELL_AGENT_ID`.
3. Put that `RETELL_AGENT_ID` into the Railway environment variables and redeploy.
4. Run `npm run db:seed` against the production `DATABASE_URL` so the dashboard has clinic data and the four planted-failure calls to show.
5. Open the live URL, confirm the seeded calls and failures render, click "Talk to the scheduling agent," complete a call, and confirm it appears scored within seconds.

Live URL: `TODO: paste the Railway public URL here once deployed`

Loom walkthrough: `TODO: paste the Loom link here`

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
