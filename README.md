# Overhear

Overhear checks that your voice agent did what it told the caller.

When your agent says "you're booked for Thursday at 3", Overhear finds the booking call in the record and checks that it succeeded, for Thursday at 3. It puts the agent's exact words next to what the system did, and says plainly when the record can't tell. Code decides every verdict. No AI model grades your calls.

It reads Retell calls with your own API key, and LiveKit Agents session reports from files you save. It runs on your computer, and your calls never leave it.

**See it on sample calls:** https://overhear-demo.up.railway.app

Or call the demo agent from that page and see your own call checked in seconds.

## Run it on your calls

You need Node 20.9 or newer, a Retell API key, and macOS or Linux (on Windows, use WSL).

```bash
git clone https://github.com/DevanshuNEU/overhear.git
cd overhear
npm ci
npm run local
```

Open http://127.0.0.1:3000, paste your Retell key and choose "Connect Retell". Overhear checks your last 25 calls, with the failed ones on top. Open any call to see what the agent said beside what the system did.

`npm run local` listens on 127.0.0.1 only. Don't start local mode with `npm run dev` or `npm start`: those listen on every network interface, and Overhear refuses every request when they do.

## On LiveKit Agents

LiveKit has no API Overhear uses to list past calls, so your agent saves one session report per call:

```python
import json
from pathlib import Path

async def on_session_end(ctx):
    report = ctx.make_session_report()
    Path("reports").mkdir(exist_ok=True)
    path = Path("reports") / f"{report.job_id}.json"
    path.write_text(json.dumps(report.to_dict()))
```

Register it with `@server.rtc_session(on_session_end=on_session_end)` (livekit-agents 1.8). Then either open the files in the dashboard ("Open session reports" on the first screen of `npm run local`), or check a folder from the terminal:

```bash
npm run check -- reports/
```

It prints one line per call and exits 1 when any call failed, so it can run in CI. Retell exports work with it too.

Overhear guesses your agent's tools from their names, so a transfer your agent promised and never made reads Needs review ("Couldn't check"), not Failed. To turn on the strict check, write a policy file that names every tool the agent has, and pass it with `--policy policy.json`, or save it as `~/.overhear/policy.json` for the dashboard. See [docs/policy.md](docs/policy.md).

## What it checks

Each check is read from the call record:

- **Promises are backed by the system.** "You're booked", "I've cancelled it", "I've texted the on-call surgeon": a matching tool call ran before the agent said so, and it succeeded.
- **Spoken details match the booking.** The day, time and provider the agent said match what the booking tool committed. When the record has nothing to compare a spoken detail with, the check reads Couldn't check, not Passed.
- **Promised transfers happen.** "I'm transferring you now": a transfer was attempted and it worked.
- **The caller was verified before any change.** When the agent has a verify tool, every booking, cancel or reschedule must come after a successful check of who is calling.
- **A failed tool is never a quiet pass.** If a booking or lookup tool failed and nothing got done after it, the call needs review.

A caller who hangs up while the agent is still announcing a transfer is not a failed transfer, because the transfer never had a chance to start. A caller who waited and got nothing is.

Here is a real call from our demo agent. The agent told the caller twice that it was transferring them to a nurse, at 2:01 and at 2:22. The record shows no transfer tool was ever called. Overhear marks the call Failed, quotes both sentences, and lists the tools that did run.

Under the verdict, a "Call experience" line says how the call sounded to the caller. It flags goodbye loops, system errors read out loud, and dates and times read like a computer would. These never change the verdict.

## What the verdicts mean

- **Failed:** a rule was broken, and the call record shows it.
- **Needs review:** nothing was broken, but a rule couldn't be checked from the record, the agent put the caller's request off, or a tool failed and nothing got done. The report says which.
- **Passed:** every promise that applied was kept.
- **Nothing done:** the caller said almost nothing and the agent took no action.

A call with a rule Overhear couldn't check is never marked Passed.

## Talk to your agent

Choose "Test call" at the top of the dashboard to call one of your Retell agents from the browser. The transcript fills in as you talk. When you hang up, the call is checked like any other.

## Keep a call as a test

On the report of a Retell call, choose "Keep as a test". Overhear saves the call and the verdict you confirmed on your computer. `npm run check:pinned` re-checks every kept call offline and fails when an answer changes, so you can run it in CI.

## Your key and your calls

- The key is kept in `~/.overhear/config.json`, in a folder only you can open (file mode 0600). `OVERHEAR_HOME` moves it.
- It goes only to Retell, to read your calls. It is never logged.
- "Disconnect" deletes it. So does deleting the file.
- A hosted copy of Overhear never takes a key.

## How accurate it is

The engine is tested against call records with a verdict a person decided (`npm run eval:engine`, full report in `eval/engine-report.md`, method in `docs/evals.md`). CI fails when a locked verdict changes.

| Measure | Value |
| --- | --- |
| Cases | 57 (3 real calls from our demo agent, 48 named breakages of them, 6 LiveKit reports generated by LiveKit's own library) |
| Verdict accuracy | 57 of 57 |
| Failed calls caught | 21 of 21 |
| False Failed on normal calls | 0 of 11 (95% interval 0% to 26%) |

We built every case, so these numbers show the engine does what we meant. They don't yet show how it does on other teams' calls. Independent results come from real calls next.

## Limits

- Retell and LiveKit Agents. Vapi and ElevenLabs are next. LiveKit support is built on reports generated by LiveKit's own library and hasn't yet been run on a real phone call.
- Whether the booking matches what the caller asked for isn't checked yet.
- Without a policy file, an agent is judged by what its tool names and results suggest, so a tool with an unusual name can leave a rule unchecked. A policy file ([`docs/policy.md`](docs/policy.md)) makes the checks strict.
- Spoken times are read in the time zone of the agent's policy (set `timezone` in `policy.json`, see [`docs/policy.md`](docs/policy.md)) or, without one, in this computer's time zone. Set your clinic's zone so "9 a.m." means what your callers heard.
- A call Retell stored without a transcript can't be checked. The list says so.

## More

- [`docs/decisions.md`](docs/decisions.md): why Overhear works the way it does, and what each choice costs.
- [`docs/policy.md`](docs/policy.md): telling Overhear about your agent's tools and time zone.
- [`docs/call-report.md`](docs/call-report.md): every rule behind a verdict.
- [`docs/evals.md`](docs/evals.md): how the engine is tested.
- [`SECURITY.md`](SECURITY.md): what stays where, what was reviewed, and how to report a problem.

## The demo agent

This repo also runs the demo clinic agent the sample calls come from: a Retell agent with its own tool endpoints, on Railway. Contributors can find its setup in [`docs/demo-agent.md`](docs/demo-agent.md).

## License

Apache-2.0. See `LICENSE`.
