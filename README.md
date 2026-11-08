# Overhear

An AI QA analyst for voice agents.

Overhear runs a healthcare-scheduling voice agent on [Retell](https://www.retellai.com/), then grades every call it takes. Code checks what the call's action log proves, and an LLM judge checks what the agent said against the clinic's real open slots. It catches hallucinated appointment slots, skipped identity checks, wrong-provider bookings, and out-of-scope medical questions on its own.

As voice AI agents move into production, someone has to watch them. Overhear is a small working prototype of one answer: an AI worker that grades other AI workers. A frontline agent takes the call, and a QA analyst scores it, with code deciding whatever the call log can prove.

> A personal project built to explore voice-AI quality assurance. Not affiliated with Retell.

This repo holds two things.

- The local product checks calls from your own Retell account, on your own machine. It is the next section.
- The hosted demo is a scheduling agent with its own database and dashboard. It is everything from [How it works](#how-it-works) down to [Deploy](#deploy).

## Run Overhear on your machine

Overhear pulls your recent Retell calls, checks each one against what the agent told the caller, and shows a verdict per call. It needs no database and no other API key.

### Requirements

- Node 20.9 or newer (`engines` in `package.json`; `.nvmrc` says 20).
- A Retell API key. Copy it from the API keys page in your Retell dashboard.
- macOS or Linux. The `local` script sets its environment variable in Unix shell syntax, so on Windows use WSL.

### Start it

```bash
npm ci
npm run local
```

`npm run local` starts the app on 127.0.0.1 only and turns on local mode, so nothing else on your network can reach it. Open http://127.0.0.1:3000 in your browser and use that address. If the terminal prints a different port, use that one.

Do not start local mode with `npm run dev` or `npm start`. They listen on every network interface, and Overhear refuses every request in that case.

### Connect your Retell key

Paste your Retell API key into the box and choose "Connect Retell". Overhear asks Retell for one call to check that the key works, then saves it.

- Where it is kept: `~/.overhear/config.json`, in a folder only you can open, with file mode 0600. To keep it somewhere else, set `OVERHEAR_HOME` to an absolute path. Overhear creates a missing folder with mode 0700. It refuses to use a folder that other users can open, so pick one only Overhear uses.
- Where it goes: only to Retell, to check the key and read your calls. The one exception is `OVERHEAR_RETELL_BASE_URL`, which is for contributors (see below). When it is set, the key goes to that address on your computer instead. Leave it unset before you connect a real key.
- What gets logged: never the key. Before anything is printed, an error is cut down to a class name, an HTTP status and a short code.
- How to remove it: choose "Disconnect" at the top of the call list, or delete the file yourself: `~/.overhear/config.json`, or `$OVERHEAR_HOME/config.json` when `OVERHEAR_HOME` is set. Disconnect removes whichever file Overhear is using.

### What happens next

Overhear pulls your last 25 calls and checks each one. You can switch to the last 50 or the last 100 on the same screen. Calls that have not ended yet are left out, and the screen says how many.

Calls that failed come first, then calls that need review, under the heading "Look at these first". Everything else is under "Everything else". Click a call to open its report. The report puts what the agent said next to what the system did, and shows the rule that broke or could not be checked.

### What the verdicts mean

The words below are the ones the screen uses (`src/report/labels.ts`).

- **Failed.** "The call broke a rule, and the call record shows it." At least one rule was broken, and the proof is in the call record.
- **Needs review.** No rule was broken, but a rule couldn't be checked, or the agent deferred the caller's request instead of completing it. A person needs to look. (The screen also has a line for a caller's request the agent neither did nor refused. Nothing sets it yet, because Overhear has no source for what the caller asked.)
- **Passed.** "Every promise that applied was kept." None of the three checks that run found a broken rule, and none was left unchecked. A call where the agent made no promises also passes, and the report says so. A Passed call is not checked against what the caller asked for, and the report says that too.
- **Nothing done.** "Nothing done. The caller said almost nothing, and the agent took no action." No rule applied, because the call had no promise and no action to check. It is not a pass and not an alarm, so the list shows it in a quiet outlined badge and sorts it after the other calls.

"Couldn't check" is the result for one rule when the call record does not hold enough to decide it. For example, the tool calls are missing from the transcript, or a tool result gave no success signal. The report lists each gap under "What we couldn't check". A call with a rule it couldn't check is never marked Passed.

### Call experience

Below the verdict, the call screen has one line, "Call experience", that says how the call sounded to the caller. It reads "no problems found" or counts the problems, and it names the checks that ran: whether the agent ended the call after saying goodbye, and whether it read system errors out loud. Each problem is a sentence with a link to the turn it rests on. These checks never change the verdict. A call that kept every promise still reads Passed when its goodbye went on for a minute, and the line is how you find out. The call list shows a quiet note on any row with problems.

### Settings

You need none of these to check your own agents.

- `OVERHEAR_DEMO_AGENT_ID` is the Retell agent id of the demo agent. It falls back to `RETELL_AGENT_ID` when blank. For the demo agent, setting either one selects the demo's own policy, which reads times in UTC. Without it, the demo agent's calls are checked with a policy inferred from their tools, in this machine's time zone, and a correct spoken time can read "Time zone unclear" and count as couldn't check. Your own agents never need it.
- `OVERHEAR_HOME` moves the folder that holds the key, as above.

Each one has a comment in [`.env.example`](.env.example).

### The hosted copy never takes a key

A hosted copy, such as the Railway demo, does not run local mode. Its key routes answer 404 and its home page sends visitors to the demo. Do not paste a Retell key into a hosted copy. It has nowhere to put one.

### For contributors

`OVERHEAR_RETELL_BASE_URL` is not a user setting. The key canary uses it to point the app at a fake Retell on your own computer. Overhear accepts it only in local mode and only for a plain `http://` address on a loopback host, so it cannot send your key anywhere else.

```bash
npm run canary:live
```

The canary starts the app in local mode with a made-up key and drives a connect, a pull and a disconnect. Then it searches every log, response, cache file and config file for that key. It exits 0 when the key is nowhere.

### Known limits

- Retell only. Other platforms are not supported yet.
- Three checks run: promises backed by the system, spoken details match the booking, and promised transfers happen. Whether a booking matches what the caller asked for is not checked yet, so a Passed call says "The caller's request wasn't checked."
- Agents other than the demo agent are judged by what their tool names and tool results suggest. A tool with an unusual name can leave a rule it couldn't check.
- A call Retell stored without a transcript can't be checked. Its row says "Retell kept no transcript for this call." That happens when the agent's data storage setting keeps only basic call details.

## Engine evals

The engine is tested against stored call records that a person labeled with the right verdict. `docs/evals.md` says how. The numbers below come from `eval/engine-report.md`, which `npm run eval:engine` writes. CI fails when that file goes stale.

Every case so far is constructed. The 3 samples are scrubbed calls from our own demo agent, and the 30 mutations are named breakages of those samples, such as changing a spoken time by an hour. We built both, so these numbers show that the engine does what we meant. They do not show how it does on other people's calls. Independent results come from real calls later. Until then that part of the report says "No cases yet."

| Measure | Value | n |
| --- | --- | --- |
| Cases | 33 (3 samples, 30 mutations) | 33 |
| Independent cases | 0 | 0 |
| Verdict accuracy | 100% (33 of 33), 95% interval 90% to 100% | 33 |
| Precision of failed | 100% (14 of 14), 95% interval 78% to 100% | 14 |
| Recall of failed | 100% (14 of 14), 95% interval 78% to 100% | 14 |
| False failed on normal calls | 0% (0 of 6), 95% interval 0% to 39% | 6 |

Read the intervals along with the rates. Six normal calls cannot rule out a false failed rate near 39%.

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

<a id="evaluation"></a>

## Demo judge evaluation

The hosted demo's judge is measured against a labeled gold set (`npm run eval`, results in `eval/report.json`, rendered on `/eval`). The current report, from 2026-09-27 with `claude-sonnet-5` at low effort:

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

<a id="getting-started"></a>

## Getting started with the demo

This sets up the hosted demo's own stack. To check your own Retell calls instead, see [Run Overhear on your machine](#run-overhear-on-your-machine).

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
npm run dev           # http://localhost:3000/demo
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
   - `APP_URL`, the Railway-issued public URL for the service, shaped like `https://<your-service>.up.railway.app`
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

## License

Apache-2.0. See [`LICENSE`](LICENSE).
