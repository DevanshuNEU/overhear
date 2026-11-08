# Pinned calls

A pinned call is a real call you saved as a regression test for Overhear. It holds the call's record and what you confirmed Overhear should say about it: the verdict, the contracts you ticked and the call experience checks you ticked. `npm run check:pinned` reads the call again later and fails when any of those answers changed.

A pin tests Overhear's judgment of a past call. It does not test your agent: a stored record reads the same forever, whatever your team fixes. The use is safe upgrades: after you update Overhear, CI shows every call it changed its mind about.

Saving a pin from the app is not built yet. This command reads the pins that are in a folder.

A pin is an eval case with a `pin` block (see [evals.md](evals.md#pinned-calls) for the file format). It lives in `~/.overhear/pinned/` (or `$OVERHEAR_HOME/pinned/`), one `pin-<call>-<hash>.json` file per call.

## What a pin keeps

A pin can hold names, dates of birth and health details, because it holds the call's transcript and tool data. It leaves out the recording and log links, the caller's and agent's phone numbers, dynamic variables, metadata, the call summary and your API key. Everything else Retell returned for the transcript stays as Retell sent it, including tool arguments and results, because the verdict depends on them.

Overhear does not remove names, dates of birth, phone numbers or health details from a pin, and it does not claim to. Check who can see a folder of pins before you commit it.

## The command

```
npm run check:pinned
npm run check:pinned -- --dir <folder>
npm run check:pinned -- --json
npm run check:pinned -- --verbose
```

With no `--dir` it reads the pinned folder in your Overhear home. With `--dir` it reads a folder of exported pins, such as one kept in your repo.

Each pin goes through the same engine that reads your calls, in the time zone it was pinned in. A pin holds only when the engine returns a report and every item the pin kept reads the same: the verdict, each ticked contract and each ticked experience check. A call that now has no report is a change.

```
Overhear checked 7 pinned calls: 6 held, 1 changed.

changed  pin-call-8f2a9c-1c9e0d4b  pinned 2026-11-08 with 0.1.0
         verdict: was Failed, now Needs review
         transfer_kept: was violated, now unverified
         note: nurse transfer promised, never made

Run with --json for every result.
```

Exit codes:

| Exit | Meaning |
| --- | --- |
| 0 | Every pinned call holds. Also "No pinned calls in <folder>." |
| 1 | At least one pinned call changed. |
| 2 | It could not run: a folder it does not trust, a `--dir` folder that does not exist, a pin file it cannot use (the output names the file), two pins with one id, or an unknown option. |

`--json` prints one document: `schemaVersion`, `overhear`, `dir`, `checked`, `held`, `changed`, `pins` (each with `id`, `callId`, `status`, `expected`, `actual`, `changes`) and `problems`. It is validated by `CheckReportSchema`, exported from `src/pinned/format.ts`. A run that cannot start (exit 2 before any pin is read) writes its reason to stderr and nothing to stdout.

### The folders it trusts

The default folder must be a real directory of yours, closed to other users (mode 0700), with files of mode 0600, and neither it nor any folder above it may hold a `.git`. A pin file is read without following a symlink, must be a plain file of yours, and is skipped as a problem when it is over 5 MB or does not pass the pin schema.

With `--dir` the mode checks are off, since a checkout writes 0644 files in 0755 folders, and a repo above the folder is expected. The folder must still be a real directory (not a symlink) that you own, and every file still gets the symlink, plain-file, owner, size and schema checks. The folder must hold at most 500 pin files.

## Check pins in CI

Keep exported pins in your repo, check that repo out next to Overhear at a tag you trust, and point `--dir` at the pins:

```yaml
name: pinned calls
on: [pull_request]
jobs:
  check-pinned:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          path: overhear-pins-repo
      - uses: actions/checkout@v4
        with:
          repository: <overhear owner>/overhear
          ref: <an Overhear tag>
          path: overhear
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
        working-directory: overhear
      - run: npm run check:pinned -- --dir "$GITHUB_WORKSPACE/overhear-pins-repo/overhear-pins"
        working-directory: overhear
```

Exit 1 fails the job. Pin an Overhear tag and move it on purpose: that is how you find out what an upgrade changes. Once Overhear is published, `npx overhear check` replaces the checkout and `npm ci`.

## What it never does

- It never reads your Retell key and never makes a network request. Reading pins and checking them is offline.
- It never prints call content: not the transcript, tool data or any part of the record. Text output is the pin's id, the date and Overhear version it was pinned with, your one-line note, and fixed words about what changed. `--json` adds the call id.
- It prints an engine error message only with `--verbose`, because an error message can quote the call. Leave `--verbose` off in CI logs you share.
- It never changes a pin file, and never deletes or creates one.
- It never promises that a pin is de-identified, anonymized or HIPAA compliant.

## Delete pins

Pins are plain files: `rm ~/.overhear/pinned/*.json` removes them all.
