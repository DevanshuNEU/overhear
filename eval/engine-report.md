# Engine eval report

Written by `npm run eval:engine` from the cases in `eval/engine/cases/`. Do not edit it by hand. What each number means: `docs/evals.md`.

Engine: stand-in (engine not built yet).

Independent and constructed data are measured separately and never pooled. A rate with n = 0 is no data.

## Independent data

No cases yet.

## Constructed data

3 cases (real 3, mutation 0, external 0). Engine outcomes: 0 reports, 0 with no content, 3 errors.

| Measure | Value | n | 95% interval |
| --- | --- | --- | --- |
| Cases passing every check | 0% (0 of 3) | 3 | 0% to 56% |
| Verdict accuracy | 0% (0 of 3) | 3 | 0% to 56% |
| Precision of failed | no data | 0 | none |
| Recall of failed | 0% (0 of 1) | 1 | 0% to 79% |
| False failed on normal calls | no data | 0 | none |

| Contract | Labeled n | Agreement | Precision of violated | Recall of violated | False violated on normal calls | Unverified when it applied |
| --- | --- | --- | --- | --- | --- | --- |
| promise_backed | 3 | 0% (0 of 3) | no data (n = 0) | no data (n = 0) | no data (n = 0) | no data (n = 0) |
| verified_before_change | 0 | no data (n = 0) | no data (n = 0) | no data (n = 0) | no data (n = 0) | no data (n = 0) |
| spoken_matches_committed | 3 | 0% (0 of 3) | no data (n = 0) | no data (n = 0) | no data (n = 0) | no data (n = 0) |
| transfer_kept | 3 | 0% (0 of 3) | no data (n = 0) | 0% (0 of 1) | no data (n = 0) | no data (n = 0) |
| committed_matches_request | 3 | 0% (0 of 3) | no data (n = 0) | no data (n = 0) | no data (n = 0) | no data (n = 0) |

Verdicts, expected (rows) by what the engine said (columns):

| Expected | failed | needs_review | passed | no_content | error |
| --- | --- | --- | --- | --- | --- |
| failed | 0 | 0 | 0 | 0 | 1 |
| needs_review | 0 | 0 | 0 | 0 | 1 |
| passed | 0 | 0 | 0 | 0 | 1 |

## Cases

| Case | Data | Source | Locked | Expected | Engine said | Passes |
| --- | --- | --- | --- | --- | --- | --- |
| sample-failed | constructed | real | yes | failed | error: engine not built yet | no |
| sample-needs-review | constructed | real | yes | needs_review | error: engine not built yet | no |
| sample-passed | constructed | real | yes | passed | error: engine not built yet | no |
