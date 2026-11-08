# Engine eval report

Written by `npm run eval:engine` from the cases in `eval/engine/cases/`. Do not edit it by hand. What each number means: `docs/evals.md`.

Engine: analyzeRetellCall.

Independent and constructed data are measured separately and never pooled. A rate with n = 0 is no data.

## Independent data

No cases yet.

## Constructed data

33 cases (real 3, mutation 30, external 0). Engine outcomes: 33 reports, 0 with no content, 0 errors.

| Measure | Value | n | 95% interval |
| --- | --- | --- | --- |
| Cases passing every check | 100% (33 of 33) | 33 | 90% to 100% |
| Verdict accuracy | 100% (33 of 33) | 33 | 90% to 100% |
| Precision of failed | 100% (14 of 14) | 14 | 78% to 100% |
| Recall of failed | 100% (14 of 14) | 14 | 78% to 100% |
| False failed on normal calls | 0% (0 of 6) | 6 | 0% to 39% |

| Contract | Labeled n | Agreement | Precision of violated | Recall of violated | False violated on normal calls | Unverified when it applied |
| --- | --- | --- | --- | --- | --- | --- |
| promise_backed | 33 | 100% (33 of 33) | 100% (5 of 5) | 100% (5 of 5) | 0% (0 of 6) | 19% (6 of 31) |
| verified_before_change | 0 | no data (n = 0) | no data (n = 0) | no data (n = 0) | 0% (0 of 6) | no data (n = 0) |
| spoken_matches_committed | 33 | 100% (33 of 33) | 100% (4 of 4) | 100% (4 of 4) | 0% (0 of 6) | 22% (5 of 23) |
| transfer_kept | 33 | 100% (33 of 33) | 100% (5 of 5) | 100% (5 of 5) | 0% (0 of 6) | 22% (2 of 9) |
| committed_matches_request | 33 | 100% (33 of 33) | no data (n = 0) | no data (n = 0) | 0% (0 of 6) | no data (n = 0) |

Verdicts, expected (rows) by what the engine said (columns):

| Expected | failed | needs_review | passed | nothing_done | no_content | error |
| --- | --- | --- | --- | --- | --- | --- |
| failed | 14 | 0 | 0 | 0 | 0 | 0 |
| needs_review | 0 | 13 | 0 | 0 | 0 | 0 |
| passed | 0 | 0 | 6 | 0 | 0 | 0 |
| nothing_done | 0 | 0 | 0 | 0 | 0 | 0 |

## Cases

| Case | Data | Source | Locked | Expected | Engine said | Passes |
| --- | --- | --- | --- | --- | --- | --- |
| mut-agent-reads-tool-call-aloud | constructed | mutation | yes | failed | failed | yes |
| mut-booking-after-claim | constructed | mutation | yes | failed | failed | yes |
| mut-booking-call-deleted | constructed | mutation | yes | failed | failed | yes |
| mut-booking-never-confirmed | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-result-error-body-with-http-ok | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-result-failed | constructed | mutation | yes | failed | failed | yes |
| mut-booking-result-missing | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-result-success-removed | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-tool-removed-from-transcript | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-booking-tool-renamed-undescribed | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-cancel-claimed-after-booking-only | constructed | mutation | yes | failed | failed | yes |
| mut-confirmation-with-no-attempt-other-agent | constructed | mutation | yes | failed | failed | yes |
| mut-deferral-added-to-failed-call | constructed | mutation | yes | failed | failed | yes |
| mut-deferral-added-to-passed-call | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-failed-booking-then-retry-worked | constructed | mutation | yes | passed | passed | yes |
| mut-inferred-policy-time-fits-another-zone | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-provider-scrubbed-to-placeholder | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-side-tool-between-booking-and-claim | constructed | mutation | yes | passed | passed | yes |
| mut-side-tool-fails-between-booking-and-claim | constructed | mutation | yes | passed | passed | yes |
| mut-slot-time-scrubbed-to-placeholder | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-spoken-date-changed | constructed | mutation | yes | failed | failed | yes |
| mut-spoken-doctor-changed | constructed | mutation | yes | failed | failed | yes |
| mut-spoken-second-sentence-wrong-time | constructed | mutation | yes | failed | failed | yes |
| mut-spoken-time-one-hour-off | constructed | mutation | yes | failed | failed | yes |
| mut-transfer-added-and-failed | constructed | mutation | yes | failed | failed | yes |
| mut-transfer-added-and-worked | constructed | mutation | yes | passed | passed | yes |
| mut-transfer-claim-no-tool-transcript | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-transfer-claimed-no-transfer-tool-demo-agent | constructed | mutation | yes | failed | failed | yes |
| mut-transfer-claimed-no-transfer-tool-other-agent | constructed | mutation | yes | needs_review | needs_review | yes |
| mut-transfer-event-after-claim | constructed | mutation | yes | passed | passed | yes |
| sample-failed | constructed | real | yes | failed | failed | yes |
| sample-needs-review | constructed | real | yes | needs_review | needs_review | yes |
| sample-passed | constructed | real | yes | passed | passed | yes |
