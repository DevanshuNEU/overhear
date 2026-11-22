# The call report

`src/report/` holds the shape of what the Overhear engine produces for one call and the dashboard reads. It is the seam between the two, so each can be built against it.

| File | What it is |
|---|---|
| `schema.ts` | The zod schema. Types are inferred from it, so there is one definition. |
| `labels.ts` | The only mapping from code values to the words people read, and `headlineFor`. |
| `samples/*.json` | Three scrubbed real calls as reports: failed, needs review, passed. Each has an empty `experience`. |
| `samples/index.ts` | The same files, parsed and typed, for the dashboard and the engine's tests. |

Nothing here uses a Node API, so a browser can load all of it.

## Reading a report

A `CallReport` answers three questions for one call.

- What did the agent say, and what did the system do? Each contract result holds `findings`. A finding points into `evidence.items` by `seq`: `said` (agent turns), `did` (tool calls, results, backend actions, events) and `asked` (caller turns). The "said | did" view is those lists, with no guessing about which seq is which.
- Do we trust the answer? `verdict` is `failed`, `needs_review`, `passed` or `nothing_done` (the caller said almost nothing and the agent took no action, shown as "Nothing done"). Results are `violated`, `passed`, `unverified` (couldn't check), `not_applicable` or `not_run`. `evidence.gaps` lists what was missing, skipped, ambiguous or contradictory.
- How did the call sound? `experience` lists the call experience checks that ran (`agent_ends_call`, `error_handled`, `spoken_format`) and the `problems` they found, each with a `text` and the agent turns (`seqs`) it rests on. A report stored before this field existed parses with the default `{ ran: [], problems: [] }`.
- What should the screen say? `headline` is the one line for the verdict, written by `headlineFor` from the wording table (spec 6.8). `reasons` says why a call needs review. `notes` only ride on a passed call.

## Rules the schema enforces

A report that breaks one of these does not validate.

1. The verdict follows the results: `failed` if any contract is violated, else `needs_review` if any is unverified or there is a reason, else `passed`. A call where no contract applied can instead be `nothing_done`, which needs: no violated or unverified contract, no `reasons`, no `notes`, every contract that ran `not_applicable`, no deferral, no tool calls or backend actions in the evidence, and its own headline line.
2. A contract's result is the worst of its findings.
3. An LLM finding alone never produces `violated`. A finding that cites a claim only the model found must be `unverified` and name the `llm_code_disagreement` gap. `llmUsed` says whether a model ran; when it did, a claim only the code found is `unverified` too.
4. A `violated` or `passed` finding cites no gap, and no evidence-level gap touches its seqs (a gap makes it `unverified`). A `violated` finding is never given when `ordering` is `none` for a contract that depends on order. A violated finding that cites an agent turn needs a detected claim at that turn. A `passed` finding has no field that differs or is unresolved, and a field with no committed value never matches.
5. Every `seq` points at a real item, in the right kind of item. Items are numbered 1, 2, 3 in timeline order. A tool result matches a tool call by id.
6. A backend action keeps the `toolCallId` it logged, and links to a tool call by `link` (`tool_call_id` or `name_and_args`). A `name_and_args` link needs exactly one tool call with that tool and those args. Without a link it needs a gap. Tier 1 evidence has no backend actions.
7. A report with no request source has `committed_matches_request` as `not_run`. If it passed, it also carries the `request_not_checked` note. Failed and needs-review reports carry no notes.
8. A deferral is never a pass. When no contract is violated, it forces `needs_review` with a `deferral` reason. When a contract is violated, the verdict is `failed` and `reasons` is empty.
9. Provenance is judged per cited claim, so one corroborated claim does not rescue a finding that also cites a model-only one. Spoken tool syntax (`tool_syntax`) is found by rule, so it needs no second detector.
10. `callFields` holds a short list of call-level fields. Links, tokens and network details are rejected.
11. In `experience`, every problem's `check` is listed in `ran`, `ran` has no repeats, and every problem seq points at an agent turn.
12. Unknown fields are rejected, so a change on one side is loud on the other.
13. A caller who hangs up is not a failed transfer. When the agent announces a transfer, no attempt follows, and the call ended with `user_hangup` while the agent was still talking (or within 8 seconds of it finishing, at 2.5 words a second), `transfer_kept` is `unverified`: a transfer can't run after the caller leaves. A record with no word timestamps gets the same result with a reason that says so, and a call that ended in `call_transfer` with no transfer tool call also stays unverified. A caller who waited longer, or a call where the agent spoke again after the caller did, stays `violated`. A completion claim ("you're booked") with no attempt behind it stays `violated` even when the caller hung up, because the agent said something false.
14. A spoken detail with nothing to compare is not "didn't apply". When a completion claim backed by a successful change says a date, a time or a provider, and the policy has no field of that type (a date needs a `date` or `datetime` field, a time a `time` or `datetime` field, a provider a `name` field), `spoken_matches_committed` is `unverified` and cites an `unresolved_committed_detail` gap naming the field. A wrong value that can be compared still reads `violated`. The contract is `not_applicable` only when the agent said no comparable detail, or no change backed a claim. An inferred policy reads these fields from the lookup items first, then from the booking's own arguments, then from the booking's own result, under these names: date, time, start, start_at, start_time, startsAt, starts_at, appointment_time, slot_time, datetime, provider, providerName, provider_name, doctor, doctor_name, practitioner. A field read from a result is never required.
15. A notification claim is a completion of the kind `notify`: the agent says in the first person, past or present perfect, that it texted, paged, notified, messaged, emailed or alerted a person or team ("I've texted the on-call surgeon", "I sent a text to the nurse", "I've let Dr. Kim know"). It is not a claim when it is an offer, a future ("I'll page"), a negation, a send in the past or by someone else ("last week", "yesterday", "earlier", "when your results came in", "Your doctor said, I've messaged the nurse"), or when the same sentence says it failed ("but the page didn't go through"); when in doubt it is not a claim. An inferred policy gives the role `notify` to a tool whose name starts with a send verb (send, text, sms, page, notify, message, alert, email) and has none of the words that say it does something else (results, size, level, through, validate, parse, delete, history, search, speech, list, get, read, check, next, threshold, count, status, opt, acknowledged, log, translate, normalize, save, fetch, set). The claim is backed by the latest `notify` call that succeeded before it: a later notify call that failed does not undo it. It is `violated` when every notify call before it failed. With no notify call before it, it is `violated` only when the policy is not inferred (a preset) and names a notify tool; otherwise it is `unverified` ("no notification tool is known for this agent"), because the practice may send the text from its own backend. With an inferred policy, a tool named like a notification may have been the booking, so a booking claim after one is `unverified`, not `violated`. Known limit: the call is not matched to the person told, so a successful notify call to someone else (a confirmation email to the patient) can back a claim about the surgeon.
16. A failed tool with nothing done after it needs review. When no contract is violated and nothing else already puts the call in review, a change or lookup whose result says it failed gives `needs_review` with a `tool_failed` reason: "A tool failed at m:ss and the caller's request wasn't done (tool)." The failure is recovered, and there is no reason, when a later call of the same role succeeded, or when any change or transfer succeeded later. It is never `failed`, because the agent made no false promise. A failed lookup followed by a successful retry does not trigger it, and with ordering `none` nothing counts as later, so it does not apply. A lookup that raises a tool error to say there is no availability counts as a failed tool, so a call that ends there needs review; a lookup that returns an empty list with success does not.
17. A booking, cancel or reschedule needs an identity check first, when the agent is known to verify. `verified_before_change` applies only when the policy is not inferred (a preset) and names a verify tool, or the call itself used one; otherwise it is `not_applicable`, with no note or reason. For each change that worked, a verify call whose result is ok must come before it: that is `passed`. With none, it is `violated` when the policy is not inferred and names a verify tool ("At m:ss the agent booked before verifying who was calling."), and `unverified` on an inferred policy where the call used a check only after the change or without success. A gap touching the change or the check, ordering `none`, a check whose result doesn't say whether it worked, or an undescribed tool used before the change also make it `unverified`. Updates are not asked for a check. The engine lists the `healthcare` pack in the report policy, which adds this contract to the four others.

## The samples

All three are real calls on the demo agent, scrubbed:

- Production ids are replaced by fake ones, and call and tool-call ids are renamed.
- Only a short list of call-level fields is kept. Recording and log links, tokens and network details are dropped.
- The names are the synthetic demo patients already in `src/db/seed.ts`.
- Dashes in the transcript text are normalized to spaced hyphens, and one mis-transcribed name for the agent is corrected. The words are otherwise unchanged.
- A test fails if a sample holds a link, an email, a phone number, a credential or a non-fake uuid.

The findings in these files were written by hand from the spec's rules. The engine's M1 output now equals the failed and passed samples, with two differences the tests spell out: M1 runs only the `scheduling` pack, so the `healthcare` pack's identity-check result and the pack name are left out of the comparison, and `committed_matches_request` is `not_run` because M1 has no request source.

The needs-review sample waits for M2's request sources. M1 finds its deferral by rule, so it reads `needs_review` with a `deferral` reason, which is the verdict the file holds. It cannot find the unanswered request the file also lists, because that needs a request source, so the full file is out of reach until M2. The sample is a proposed reading of the rules, not a settled one: whether an error apology counts as a refusal, and which of the caller's requests is the final one, are open.

No sample shows Tier 2 (a backend action linked by `tool_call_id`), because the backend log's timestamps are not exported yet. A test builds that shape from the passed sample instead.
