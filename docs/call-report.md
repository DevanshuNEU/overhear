# The call report

`src/report/` holds the shape of what the Overhear engine produces for one call and the dashboard reads. It is the seam between the two, so each can be built against it.

| File | What it is |
|---|---|
| `schema.ts` | The zod schema. Types are inferred from it, so there is one definition. |
| `labels.ts` | The only mapping from code values to the words people read, and `headlineFor`. |
| `samples/*.json` | Three scrubbed real calls as reports: failed, needs review, passed. |
| `samples/index.ts` | The same files, parsed and typed, for the dashboard and the engine's tests. |

Nothing here uses a Node API, so a browser can load all of it.

## Reading a report

A `CallReport` answers three questions for one call.

- What did the agent say, and what did the system do? Each contract result holds `findings`. A finding points into `evidence.items` by `seq`: `said` (agent turns), `did` (tool calls, results, backend actions, events) and `asked` (caller turns). The "said | did" view is those lists, with no guessing about which seq is which.
- Do we trust the answer? `verdict` is `failed`, `needs_review` or `passed`. Results are `violated`, `passed`, `unverified` (couldn't check), `not_applicable` or `not_run`. `evidence.gaps` lists what was missing, skipped, ambiguous or contradictory.
- What should the screen say? `headline` is the one line for the verdict, written by `headlineFor` from the wording table (spec 6.8). `reasons` says why a call needs review. `notes` only ride on a passed call.

## Rules the schema enforces

A report that breaks one of these does not validate.

1. The verdict follows the results: `failed` if any contract is violated, else `needs_review` if any is unverified or there is a reason, else `passed`.
2. A contract's result is the worst of its findings.
3. An LLM finding alone never produces `violated`. A finding that cites a claim only the model found must be `unverified` and name the `llm_code_disagreement` gap. `llmUsed` says whether a model ran; when it did, a claim only the code found is `unverified` too.
4. A `violated` finding cites no gap, and is never given when `ordering` is `none` for a contract that depends on order. A violated finding that cites an agent turn needs a detected claim at that turn. A `passed` finding has no field that differs or is unresolved, and a field with no committed value never matches.
5. Every `seq` points at a real item, in the right kind of item. Items are numbered 1, 2, 3 in timeline order. A tool result matches a tool call by id.
6. A backend action keeps the `toolCallId` it logged, and links to a tool call by `link` (`tool_call_id` or `name_and_args`). A `name_and_args` link needs exactly one tool call with that tool and those args. Without a link it needs a gap. Tier 1 evidence has no backend actions.
7. A report with no request source has `committed_matches_request` as `not_run`. If it passed, it also carries the `request_not_checked` note. Failed and needs-review reports carry no notes.
8. A deferral is never a pass. When no contract is violated, it forces `needs_review` with a `deferral` reason. When a contract is violated, the verdict is `failed` and `reasons` is empty.
9. Provenance is judged per cited claim, so one corroborated claim does not rescue a finding that also cites a model-only one. Spoken tool syntax (`tool_syntax`) is found by rule, so it needs no second detector.
10. `callFields` holds a short list of call-level fields. Links, tokens and network details are rejected.
11. Unknown fields are rejected, so a change on one side is loud on the other.

## The samples

All three are real calls on the demo agent, scrubbed:

- Production ids are replaced by fake ones, and call and tool-call ids are renamed.
- Only a short list of call-level fields is kept. Recording and log links, tokens and network details are dropped.
- The names are the synthetic demo patients already in `src/db/seed.ts`.
- Dashes in the transcript text are normalized to spaced hyphens, and one mis-transcribed name for the agent is corrected. The words are otherwise unchanged.
- A test fails if a sample holds a link, an email, a phone number, a credential or a non-fake uuid.

Until the engine exists, the findings are written by hand from the spec's rules. When it does, its output for these three calls should equal these files. The needs-review sample is a proposed reading of the rules, not a settled one: whether an error apology counts as a refusal, and which of the caller's requests is the final one, are open.

No sample shows Tier 2 (a backend action linked by `tool_call_id`), because the backend log's timestamps are not exported yet. A test builds that shape from the passed sample instead.
