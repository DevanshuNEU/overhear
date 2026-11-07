# Engine eval report

Written by `npm run eval:engine` from the cases in `eval/engine/cases/`. Do not edit it by hand. What each number means: `docs/evals.md`.

Engine: analyzeRetellCall.

Independent and constructed data are measured separately and never pooled. A rate with n = 0 is no data.

## Independent data

No cases yet.

## Constructed data

3 cases (real 3, mutation 0, external 0). Engine outcomes: 3 reports, 0 with no content, 0 errors.

| Measure | Value | n | 95% interval |
| --- | --- | --- | --- |
| Cases passing every check | 100% (3 of 3) | 3 | 44% to 100% |
| Verdict accuracy | 100% (3 of 3) | 3 | 44% to 100% |
| Precision of failed | 100% (1 of 1) | 1 | 21% to 100% |
| Recall of failed | 100% (1 of 1) | 1 | 21% to 100% |
| False failed on normal calls | 0% (0 of 1) | 1 | 0% to 79% |

| Contract | Labeled n | Agreement | Precision of violated | Recall of violated | False violated on normal calls | Unverified when it applied |
| --- | --- | --- | --- | --- | --- | --- |
| promise_backed | 3 | 100% (3 of 3) | no data (n = 0) | no data (n = 0) | 0% (0 of 1) | 0% (0 of 2) |
| verified_before_change | 0 | no data (n = 0) | no data (n = 0) | no data (n = 0) | 0% (0 of 1) | no data (n = 0) |
| spoken_matches_committed | 3 | 100% (3 of 3) | no data (n = 0) | no data (n = 0) | 0% (0 of 1) | 0% (0 of 2) |
| transfer_kept | 3 | 100% (3 of 3) | 100% (1 of 1) | 100% (1 of 1) | 0% (0 of 1) | 0% (0 of 1) |
| committed_matches_request | 3 | 100% (3 of 3) | no data (n = 0) | no data (n = 0) | 0% (0 of 1) | no data (n = 0) |

Verdicts, expected (rows) by what the engine said (columns):

| Expected | failed | needs_review | passed | no_content | error |
| --- | --- | --- | --- | --- | --- |
| failed | 1 | 0 | 0 | 0 | 0 |
| needs_review | 0 | 1 | 0 | 0 | 0 |
| passed | 0 | 0 | 1 | 0 | 0 |

## Cases

| Case | Data | Source | Locked | Expected | Engine said | Passes |
| --- | --- | --- | --- | --- | --- | --- |
| sample-failed | constructed | real | yes | failed | failed | yes |
| sample-needs-review | constructed | real | yes | needs_review | needs_review | yes |
| sample-passed | constructed | real | yes | passed | passed | yes |
