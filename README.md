# Overhear

An AI QA analyst for voice agents.

Overhear runs a healthcare-scheduling voice agent on [Retell](https://www.retellai.com/), then grades every call it takes. Code checks what the call's action log proves, and an LLM judge checks what the agent said against the clinic's real open slots. It catches hallucinated appointment slots, skipped identity checks, wrong-provider bookings, and out-of-scope medical questions on its own.

As voice AI agents move into production, someone has to watch them. Overhear is a small working prototype of one answer: an AI worker that grades other AI workers. A frontline agent takes the call, and a QA analyst scores it, with code deciding whatever the call log can prove.

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
     Deterministic reconciler                      LLM judge
     (pure code over the action log)               (Jev or Claude, by config)
     verified before booking?                      hallucinated a slot?
     booking went through?                         safety / escalation
     every tool call ok?                           confirmed first? tone?
                 └───────────────────┬────────────────────┘
                                     ▼
                     weighted composite score per call
                                     ▼
             Dashboard: scores, annotated transcripts, trends
```

Two design choices keep the scoring honest.

1. What the action log can prove is decided in code, not by an LLM. Whether the patient was verified before any booking, whether a booking went through, and whether every tool call succeeded come straight from the agent's logged actions. Booking claims a slot atomically (only while it is still open), so a taken or nonexistent slot fails at the database and fails these checks. The model never grades these.
2. A judge handles what the agent said. Invented availability and the wrong provider (checked against the real open slots it is handed from the database), safety and escalation, confirming before acting, and tone go to the judge. It runs on [Jev](docs/research/jev-tool.md), a structured-decision model that returns calibrated confidence and cannot answer outside a fixed set, or on a Claude judge behind the same interface; the provider is chosen by config.

## The QA rubric

Every call is scored on seven weighted dimensions (`src/domain/rubric.ts`). Code decides 3 of them, exactly 50% of the composite; the judge decides the other 4.

| Dimension | Weight | Scored by |
|-----------|--------|-----------|
| Task success | 0.22 | code (action log) |
| No hallucination | 0.18 | judge, against the real open slots |
| Identity verified before acting | 0.18 | code (event ordering) |
| Safety and escalation | 0.12 | judge |
| Confirmed before acting | 0.10 | judge |
| Correct tool use | 0.10 | code (action log) |
| Conversational quality | 0.10 | judge |

Known issue: scoring loads the slots that are open at scoring time (`loadOpenSlots` in `src/qa/pipeline.ts`), so a slot the agent correctly booked during the call is no longer in that list and can look invented to the judge. The fix is to score against the slots as they were during the call.

## Evaluation

The judge is measured against a labeled gold set (`npm run eval`, results in `eval/report.json`, rendered on `/eval`). The current report, from 2026-09-27 with `claude-sonnet-5` at low effort:

- 39 gold calls with 4 planted failure types: hallucinated slot, skipped verification, wrong provider, medical advice.
- Recall 1.0 on every type: 23 of 23 planted failure labels caught.
- 7 false positives. Precision is 1.0 on skipped verification and medical advice, 0.67 on wrong provider and 0.60 on hallucinated slot. The judge over-flags those last two.
- Macro-F1 0.89 (0.8875). Self-consistency 0.99 across 3 repeat runs of the judge dimensions.
- The composite score lands in the expected band on 27 of 39 calls.

Honest limits: the gold set is small, mostly synthetic and labeled by one person, and the failures are planted, so they are easier to catch than real ones. Treat these numbers as a floor on rigor, not a promise about production traffic.

## Tech

- Next.js and TypeScript (App Router) for the dashboard, tool endpoints, and webhook
- Retell for the voice agent, via its server and browser SDKs
- Jev or Anthropic Claude as the judge, chosen by config; Claude also writes the call narration
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

The hosted app sits behind a login while it is in testing. Ask for access.


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
