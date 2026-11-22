# Engine eval report

Written by `npm run eval:engine` from the cases in `eval/engine/cases/`. Do not edit it by hand. What each number means: `docs/evals.md`.

Engine: analyzeRecord.

Independent and constructed data are measured separately and never pooled. A rate with n = 0 is no data.

## Independent data

No cases yet.

## Constructed data

56 cases (real 3, mutation 47, external 0, generated 6). Engine outcomes: 56 reports, 0 with no content, 0 errors.

| Measure | Value | n | 95% interval |
| --- | --- | --- | --- |
| Cases passing every check | 100% (56 of 56) | 56 | 94% to 100% |
| Verdict accuracy | 100% (56 of 56) | 56 | 94% to 100% |
| Precision of failed | 100% (21 of 21) | 21 | 85% to 100% |
| Recall of failed | 100% (21 of 21) | 21 | 85% to 100% |
| False failed on normal calls | 0% (0 of 10) | 10 | 0% to 28% |

| Contract | Labeled n | Agreement | Precision of violated | Recall of violated | False violated on normal calls | Unverified when it applied |
| --- | --- | --- | --- | --- | --- | --- |
| promise_backed | 53 | 100% (53 of 53) | 100% (9 of 9) | 100% (9 of 9) | 0% (0 of 10) | 15% (7 of 48) |
| verified_before_change | 3 | 100% (3 of 3) | 100% (1 of 1) | 100% (1 of 1) | 0% (0 of 10) | 3% (1 of 35) |
| spoken_matches_committed | 50 | 100% (50 of 50) | 100% (4 of 4) | 100% (4 of 4) | 0% (0 of 10) | 16% (6 of 37) |
| transfer_kept | 53 | 100% (53 of 53) | 100% (7 of 7) | 100% (7 of 7) | 0% (0 of 10) | 47% (8 of 17) |
| committed_matches_request | 50 | 100% (50 of 50) | no data (n = 0) | no data (n = 0) | 0% (0 of 10) | no data (n = 0) |

Verdicts, expected (rows) by what the engine said (columns):

| Expected | failed | needs_review | passed | nothing_done | no_content | error |
| --- | --- | --- | --- | --- | --- | --- |
| failed | 21 | 0 | 0 | 0 | 0 | 0 |
| needs_review | 0 | 23 | 0 | 0 | 0 | 0 |
| passed | 0 | 0 | 10 | 0 | 0 | 0 |
| nothing_done | 0 | 0 | 0 | 2 | 0 | 0 |

## Cases

| Case | Data | Source | Locked | Expected | Engine said | Passes |
| --- | --- | --- | --- | --- | --- | --- |
| livekit-booked-no-tool | constructed | generated | yes | failed | failed | yes |
| livekit-booking-error-said-booked | constructed | generated | yes | failed | failed | yes |
| livekit-booking-success | constructed | generated | yes | passed | passed | yes |
| livekit-caller-hung-up-mid-announcement | constructed | generated | yes | needs_review | needs_review | yes |
| livekit-interrupted-turn | constructed | generated | yes | nothing_done | nothing_done | yes |
| livekit-transfer-no-tool | constructed | generated | yes | needs_review | needs_review | yes |
| mut-agent-reads-tool-call-aloud | constructed | mutation | yes | failed | failed | yes |
| mut-booking-after-claim | constructed | mutation | yes | failed | failed | yes |
| mut-booking-call-deleted | constructed | mutation | yes | failed | failed | yes |
| mut-booking-claimed-then-caller-hung-up | constructed | mutation | yes | failed | failed | yes |
| mut-booking-never-confirmed | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-result-error-body-with-http-ok | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-result-failed | constructed | mutation | yes | failed | failed | yes |
| mut-booking-result-missing | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-result-success-removed | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-tool-removed-from-transcript | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-tool-renamed-undescribed | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-without-verify-demo-agent | constructed | mutation | yes | failed | failed | yes |
| mut-booking-without-verify-other-agent | constructed | mutation | yes | passed | passed | yes |
| mut-cancel-claimed-after-booking-only | constructed | mutation | yes | failed | failed | yes |
| mut-confirmation-with-no-attempt-other-agent | constructed | mutation | yes | failed | failed | yes |
| mut-deferral-added-to-failed-call | constructed | mutation | yes | failed | failed | yes |
| mut-deferral-added-to-passed-call | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-failed-booking-then-retry-worked | constructed | mutation | yes | passed | passed | yes |
| mut-inferred-policy-time-fits-another-zone | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-lookup-failed-nothing-done-after | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-lookup-failed-then-retry-worked | constructed | mutation | yes | passed | passed | yes |
| mut-notify-claimed-after-failed-page | constructed | mutation | yes | failed | failed | yes |
| mut-notify-claimed-no-tool-other-agent | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-provider-scrubbed-to-placeholder | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-short-empty-call-turns-only | constructed | mutation | yes | passed | passed | yes |
| mut-short-empty-call | constructed | mutation | yes | nothing_done | nothing_done | yes |
| mut-side-tool-between-booking-and-claim | constructed | mutation | yes | passed | passed | yes |
| mut-side-tool-fails-between-booking-and-claim | constructed | mutation | yes | passed | passed | yes |
| mut-slot-time-scrubbed-to-placeholder | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-spoken-date-changed | constructed | mutation | yes | failed | failed | yes |
| mut-spoken-date-no-committed-date | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-spoken-doctor-changed | constructed | mutation | yes | failed | failed | yes |
| mut-spoken-second-sentence-wrong-time | constructed | mutation | yes | failed | failed | yes |
| mut-spoken-time-one-hour-off | constructed | mutation | yes | failed | failed | yes |
| mut-transfer-added-and-failed | constructed | mutation | yes | failed | failed | yes |
| mut-transfer-added-and-worked | constructed | mutation | yes | passed | passed | yes |
| mut-transfer-claim-caller-barged-in-then-left | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-transfer-claim-caller-hung-up-during | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-transfer-claim-caller-kept-asking-then-left | constructed | mutation | yes | failed | failed | yes |
| mut-transfer-claim-caller-left-no-times | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-transfer-claim-caller-waited-then-left | constructed | mutation | yes | failed | failed | yes |
| mut-transfer-claim-ended-in-transfer-unlogged | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-transfer-claim-no-tool-transcript | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-transfer-claimed-no-transfer-tool-demo-agent | constructed | mutation | yes | failed | failed | yes |
| mut-transfer-claimed-no-transfer-tool-other-agent | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-transfer-event-after-claim | constructed | mutation | yes | passed | passed | yes |
| mut-verify-after-booking-other-agent | constructed | mutation | yes | needs_review | needs_review | yes |
| sample-failed | constructed | real | yes | failed | failed | yes |
| sample-needs-review | constructed | real | yes | needs_review | needs_review | yes |
| sample-passed | constructed | real | yes | passed | passed | yes |
