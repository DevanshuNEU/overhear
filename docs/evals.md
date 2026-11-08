# Engine evals

The engine eval runs stored call records through the said-versus-did engine (`src/engine/`) and checks each result against a label a person decided. It tells us how often the engine is right, and CI fails when a change breaks a verdict we locked.

This is separate from `src/eval/`, which measures the demo dashboard's old LLM judge.

```
npm run eval:engine
```

That runs every case in `eval/engine/cases/` and writes `eval/engine-report.json` (everything) and `eval/engine-report.md` (a short table). Commit both. A test fails when they are stale.

## What a case is

A case is one raw call record plus what the engine should say about it. It is one JSON file, `eval/engine/cases/<id>.json`, and the schema is `EvalCaseSchema` in `src/engine/eval/case.ts`. A case that breaks the schema fails loudly when it is read, with the file name and every problem.

| Field | Meaning |
|---|---|
| `schemaVersion` | `1`. |
| `id` | Stable, lowercase words and digits joined by hyphens. The file name is the id. |
| `source` | `real` (a call that happened, scrubbed), `mutation` (a programmatic edit of another case) or `external` (converted from data someone else built, such as a public benchmark). |
| `independent` | `true` only for data we did not build. A mutation is never independent. |
| `platform` | `retell`. |
| `locked` | When `true`, CI fails if the engine's verdict differs from `expect.verdict`. |
| `label` | `by` (who decided the truth), `at` (a date, or a date and time) and an optional `note` saying why. |
| `derivedFrom` | For a mutation, and only a mutation: the id of its parent case. |
| `tz` | Optional. The IANA time zone spoken times are read in when the agent's policy names none. Default `UTC`. |
| `pin` | Optional. Only on a pinned call (see "Pinned calls"). |
| `expect` | `verdict` (`failed`, `needs_review`, `passed` or `nothing_done`); optional `contracts`, the result a person checked for each contract; optional `experience`, the call experience checks a person kept, each `problem` or `clean`; optional `mustCite`, turns and tool items (by evidence `seq`) a contract's findings must cite. |
| `record` | The raw record exactly as the platform's API returns it (Retell: `GET /v2/get-call`), scrubbed. |

The schema also refuses an expectation that contradicts itself: a violated contract with a verdict other than `failed`, an unverified contract with `passed`, or `mustCite` on a contract expected not to apply.

The same format is meant for two later writers: the product's "pin this call as a regression test" (a pinned call is a case its user labeled) and a converter for outside data such as tau-bench. Both write files with `formatCase`, so every case file reads the same way.

## Kept experience checks

`expect.experience` maps a call experience check (`agent_ends_call`, `error_handled`, `spoken_format`) to `problem` (the engine must report one) or `clean` (the engine must run the check and find nothing). A check left out is not scored. Each kept check counts toward the case passing, and the case result lists what the engine said: `problem`, `clean`, `not_run` (the report's `experience.ran` does not list the check, so its silence proves nothing and it disagrees even for `clean`) or `no_report` (the engine gave no report). A locked case's lock still covers the verdict only.

## Pinned calls

A pinned call is a case a person saved from a real call, so the engine keeps reading that call the way they confirmed. It is a normal case with these rules, which the schema enforces:

- `source` is `real`, `platform` is `retell`, `independent` is `false` and `locked` is `true`.
- `tz` is required: the zone the call was pinned in, so spoken times read the same later.
- `label.note`, when present, is one line of at most 280 characters. By convention `label.by` is `you` (the schema does not check it).
- `pin` holds `callId`, `agentId`, `agentVersion` (a string, or `null` when the call has none), `pinnedWith` (the Overhear version that read it) and, for a fix pin, `fixes`: the id of the pinned case it fixes.
- `expect.verdict` is always kept. `expect.contracts` and `expect.experience` hold only the items the person ticked.

`pin` is written right after `label` in the file. A pin is tested like any case: the runner compares the engine's reading with `expect`, and the case breaks its lock when the verdict changes.

## Adding a case

1. Get the record. It must be scrubbed: no real names, numbers, emails or dates of birth. Nothing unscrubbed enters this repo.
2. Write the case and save it with `formatCase` (one transcript item per line, so a diff shows the line that changed). The file name must be `<id>.json`.
3. Label only what you checked. Leave a contract out of `expect.contracts` rather than guess it.
4. Set `independent` honestly. Our own demo calls and anything we built are constructed (`false`).
5. Lock it if its verdict should never change silently.
6. Run `npm run eval:engine` and commit the case with both report files.

To change a locked case's verdict on purpose, edit `expect.verdict` in the same pull request and say why in `label.note`.

The three sample cases (`sample-*`) are made from the scrubbed samples in `src/report/samples/` by `src/engine/testing/sample-cases.ts`. After a sample changes, run `npm run eval:engine -- --write-sample-cases`. The needs-review sample expects `passed` for now: it needs review only because a model found an unanswered request, and M1 has no request source. It changes to `needs_review` when request sources land.

## Mutations

A mutation is a deliberate breakage of a sample call with the verdict it must produce: delete the booking before "you're booked", flip its result to a failure, change the spoken time by an hour, add a transfer claim with no transfer. The product's first rule (never call a call passed or failed on evidence that does not prove it) becomes a test that runs on every change.

Mutations are code, not new data: `src/engine/testing/mutations.ts` holds each one as a small named edit of a sample's record, with the expected verdict and contract results written from the rules, never copied from the engine. `npm run eval:engine -- --write-mutation-cases` writes them to `eval/engine/cases/mut-*.json`, and a test fails when a file differs from the code. They are `source: "mutation"`, locked, and never independent, so they land in the constructed section of the report. Their numbers show the engine does what we meant on calls we built, not how it does in the world.

`src/engine/testing/mutations.test.ts` also checks coverage: every contract the engine runs has a mutation that changes its result, the suite has violated and unverified cases for each, and every gap code is either produced by a mutation or listed in `GAP_CODES_NOT_EMITTED` with the reason the engine never emits it. A new gap code or contract fails that test until it gets a mutation.

A mutation the engine gets wrong is not bent to pass. It goes in `KNOWN_FAILURES` with one line saying why, its case is written unlocked, and the report shows it failing until the engine is fixed. The test then insists it still fails, so the entry is removed when the bug is.

## What each number means

Every rate shows k of n and a Wilson 95% interval. A rate with n = 0 is "no data", never 0% or 100%.

A case the engine gave no report for (an error, or no content) is never counted in the engine's favour. It is wrong for accuracy and agreement and a miss for recall. It is left out of precision and of the false-failed rate, where counting it would flatter the engine.

For the verdict, per group:

- **Cases passing every check**: the verdict, every labeled contract and every required citation match.
- **Verdict accuracy**: cases whose verdict equals the label.
- **Precision of failed**: of the calls the engine called `failed`, how many were labeled `failed`.
- **Recall of failed**: of the calls labeled `failed`, how many the engine called `failed`.
- **False failed on normal calls**: of the calls labeled `passed` that the engine gave a verdict on, how many it called `failed`. This is the costly error, so it has its own line.

Per contract:

- **Labeled n**: cases where a person labeled this contract.
- **Agreement**: labeled cases where the engine's result equals the label.
- **Precision and recall of violated**: as above, for `violated`, over labeled cases.
- **False violated on normal calls**: of the calls labeled `passed` that the engine reported on, how many had this contract `violated`. It counts every normal call, labeled for the contract or not.
- **Unverified when it applied**: of the reports where the contract was `violated`, `passed` or `unverified`, how many were `unverified`.

The JSON report also holds the confusion tables (expected by actual) and every case's result.

## Independent and constructed data are never pooled

Data we built (our demo calls, mutations, scripted test calls) tells us whether the engine does what we meant. Only data we did not build tells us how it does in the world. The report measures the two in separate sections and never adds them into one figure, and `groupMetrics` refuses a mix.

## Guards

- **The lock** (`src/engine/eval/locks.test.ts`): a locked case whose verdict changes fails CI.
- **Freshness** (`src/engine/eval/report-freshness.test.ts`): the report must cover the current cases and engine sources (a fingerprint of their content) and equal a fresh run. CI also runs `npm run eval:engine` and fails if the committed report differs.

## The engine the harness runs

The harness runs `analyzeRetellCall`, exported as `engine` from `src/engine/eval/engine.ts`. Before the engine existed it ran a stand-in that answered every record with `engine not built yet`. A test fails if the stand-in is ever the engine again, because every number in the report would then be about it.
