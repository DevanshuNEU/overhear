# Overhear

**Overhear checks that your voice agent did what it told the caller.**

When your agent says "you're booked for Thursday at 3", Overhear finds the booking in the call record and checks that it went through, for Thursday at 3. It puts the agent's exact words next to what the system did, and it says plainly when the record can't tell. Code decides every verdict. No AI model grades your calls.

**See it on sample calls, or call the agent yourself:** https://overhear-demo.up.railway.app

![A failed call in Overhear: the agent said it was transferring the caller twice, and no transfer was attempted](docs/images/report-failed.png)

## The call that started it

A caller rang a clinic's voice agent about a problem with their ear. The agent booked them an appointment, then said: "I'll go ahead and connect you with a nurse now regarding your ear concern." Twenty seconds later it said it again: "Transferring you to a nurse now."

Nothing happened. The agent had no way to transfer anyone, and it never tried. It said goodbye, and the call ended with the caller still thinking a nurse was on the way.

Read as a transcript, that call sounds like good service. It was polite, and the booking was right. The broken promise only shows when you put what the agent said next to what its tools did, and nothing in the call record did that. Someone would have had to read the call, line by line, and notice.

That call is the first one in the demo above. It's a real call to our own demo agent, and it's why Overhear exists.

## Why this is different

A lot of call review for voice agents asks a language model to read the transcript and give it a score. You still have to open the call to find out what went wrong, and you have to trust a second model's opinion of the first. Your engineers end up reading flagged calls by hand, which is the job the tool was meant to take off them.

Overhear works the other way round.

- **It checks claims against actions.** The agent said "booked": did a booking call run, and succeed, before it said so? The agent said "9 a.m. with Dr. Nair": is that what the booking tool wrote?
- **It shows the proof.** Every verdict comes with the agent's exact words, the tool calls behind them, and the moment in the call, so you can check it in seconds without listening to the call.
- **It says when it can't tell.** If the record can't prove a promise was kept or broken, the verdict is "Couldn't check", with the reason. It never guesses Passed, and it never raises an alarm it can't prove. A checker your team doesn't trust is worthless, so the rules put avoiding false alarms first.
- **No AI model decides.** The same call always gets the same verdict, and you can read the rule that gave it.
- **It stays on your computer.** Overhear runs locally with your own key. Your calls never leave your machine.

## What it catches

| The agent says | Overhear checks |
| --- | --- |
| "You're booked", "I've cancelled it", "I've texted the on-call surgeon" | A matching tool ran before the agent said so, and it succeeded. |
| "Thursday the 3rd at 9 a.m. with Dr. Lee" | The day, time and provider match what the booking tool committed. |
| "I'm transferring you now" | A transfer was attempted, and it worked. |
| Anything that books, moves or cancels | The caller's identity was checked first, when the agent has a way to check it. |
| "Please try calling back shortly" | A tool failed and nothing got done, so the call needs review, not a quiet pass. |

It doesn't blame the agent for what was out of its hands. A caller who hangs up while the agent is still saying "I'm transferring you" is not a failed transfer, because the transfer never had a chance to start. A caller who waits and gets nothing is.

Under each verdict, a "Call experience" line says how the call sounded to the caller: goodbye loops, system errors read out loud, dates and times read like a computer would. These never change the verdict.

## What the verdicts mean

- **Failed.** The agent promised something the call record shows didn't happen.
- **Needs review.** Nothing was broken, but something couldn't be checked from the record, the agent put the caller's request off, or a tool failed and nothing got done. The report says which.
- **Passed.** Every promise that applied was kept.
- **Nothing done.** The caller said almost nothing, and the agent took no action.

## Try it in a minute

Open https://overhear-demo.up.railway.app.

1. Look at the sample calls. A few are real calls to our demo agent, and the rest are those calls with one thing changed, such as a booking that fails. The engine checks each one when the page loads. The first is the call above.
2. Choose **Call the demo agent** and talk to Riley, the receptionist at a made-up clinic in New York. Book an appointment as one of the test patients the page lists.
3. Hang up. A few seconds later your own call appears, checked, with the proof.

## Run it on your calls

You need Node 20.9 or newer, and macOS or Linux (on Windows, use WSL).

```bash
git clone https://github.com/DevanshuNEU/overhear.git
cd overhear
npm ci
npm run local
```

Then open http://127.0.0.1:3000.

### On Retell

Paste your Retell API key and choose **Connect Retell**. Overhear checks your last 25 calls, with the failed ones on top. Open any call to see what the agent said next to what the system did, or choose **Test call** to talk to one of your agents and see that call checked.

### On LiveKit Agents

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

Register it with `@server.rtc_session(on_session_end=on_session_end)` (livekit-agents 1.8). Then choose **Open session reports** on the first screen, or check a folder from the terminal:

```bash
npm run check -- reports/
```

It prints one line per call and exits 1 when any call failed, so it can run in CI. Retell exports work with it too. [`examples/livekit-clinic`](examples/livekit-clinic) is a small LiveKit agent you can run in your terminal to try this end to end.

### Tell it about your agent

Without help, Overhear guesses your agent's tools from their names, and anything it can't be sure of reads Couldn't check. A policy file names your tools and your clinic's time zone, and turns on the strict checks: for example, a transfer the agent promised and never made reads Failed instead of Couldn't check. Pass it with `--policy policy.json`, or save it as `~/.overhear/policy.json` for the dashboard. See [`docs/policy.md`](docs/policy.md).

`npm run local` listens on 127.0.0.1 only. Don't start local mode with `npm run dev` or `npm start`: those listen on every network interface, and Overhear refuses every request when they do.

## Turn a bad call into a test

On the report of a Retell call, choose **Keep as a test**. Overhear saves the call and the verdict you confirmed. `npm run check:pinned` re-checks every kept call offline and fails when an answer changes, so CI fails if Overhear's reading of a kept call ever changes. A kept call is re-checked without your policy file today, so a verdict that depended on the policy can come back as Couldn't check.

## Your key and your calls

- The key is kept in `~/.overhear/config.json`, in a folder only you can open (file mode 0600). `OVERHEAR_HOME` moves it.
- It goes only to Retell, to read your calls. It is never logged.
- **Disconnect** deletes it. So does deleting the file.
- A hosted copy of Overhear never takes a key.

[`SECURITY.md`](SECURITY.md) has the details, what was reviewed, and how to report a problem.

## How accurate it is

Every rule is tested against call records with a verdict a person decided (`npm run eval:engine`, full report in [`eval/engine-report.md`](eval/engine-report.md), method in [`docs/evals.md`](docs/evals.md)). CI fails if a locked verdict ever changes.

| Measure | Value |
| --- | --- |
| Cases | 57 (3 real calls from our demo agent, 48 named breakages of them, 6 LiveKit reports generated by LiveKit's own library) |
| Verdict accuracy | 57 of 57 |
| Failed calls caught | 21 of 21 |
| False Failed on normal calls | 0 of 11 (95% interval 0% to 26%) |

We built every case ourselves, so these numbers show the engine does what we meant. They don't yet show how it does on other teams' calls. That comes from real calls next, and it will be published here the same way.

## What it doesn't do yet

- **Platforms.** Retell and LiveKit Agents. Vapi and ElevenLabs are next. LiveKit support is built on reports generated by LiveKit's own library and hasn't yet been run on a real phone call.
- **The caller's request.** Whether the booking matches what the caller asked for isn't checked yet.
- **Unknown agents.** Without a policy file, an agent is judged by what its tool names and results suggest, so a tool with an unusual name can leave a rule unchecked.
- **Time zones.** Spoken times are read in the policy's time zone or, without one, in this computer's. Set your clinic's zone so "9 a.m." means what your callers heard.
- **What it can't see.** Audio problems that never reach the transcript, such as a misheard name or dead air.
- **No transcript.** A call your platform stored without a transcript can't be checked. The list says so.

## Learn more

- [`docs/decisions.md`](docs/decisions.md): why Overhear works the way it does, and what each choice costs.
- [`docs/policy.md`](docs/policy.md): telling Overhear about your agent's tools and time zone.
- [`docs/call-report.md`](docs/call-report.md): every rule behind a verdict.
- [`docs/evals.md`](docs/evals.md): how the engine is tested.
- [`docs/demo-agent.md`](docs/demo-agent.md): the demo clinic agent the sample calls come from, and how to run it.

## License

Apache-2.0. See [`LICENSE`](LICENSE).
