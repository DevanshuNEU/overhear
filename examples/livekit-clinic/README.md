# LiveKit clinic agent

A small front desk voice agent for Northwind Family Clinic. The receptionist is Riley. It saves one LiveKit session report per call, so you can check real calls with Overhear.

The agent has two tools: `check_availability` and `book_appointment`. Both use a few slots held in memory. It has no transfer tool, like the Retell demo agent. It never gives medical advice and offers to connect the caller with a nurse.

## 1. Create a LiveKit Cloud project

Sign up for a free project at cloud.livekit.io. Open the project settings and copy the URL, the API key and the API secret. Put them in `examples/livekit-clinic/.env.local`:

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your-key
LIVEKIT_API_SECRET=your-secret
```

These three values are all you need. The speech to text, language model and text to speech run through LiveKit Inference, billed to the same project.

## 2. Install

Use Python 3.10 to 3.14. From `examples/livekit-clinic`:

```
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt
```

## 3. Talk to it

```
python agent.py console
```

This runs the agent in your terminal and talks through your microphone and speakers. To type instead, add the text flag:

```
python agent.py console --text
```

The report is saved when the session shuts down, not when the agent says goodbye. After the last reply, press Ctrl+C once and wait for the line `Saved session report to ...`. Then the file is in `examples/livekit-clinic/reports/`. One console session is one call.

## 4. Scripts to try

Book a slot. Say: "I'm Maria Lopez, I'd like an appointment on December 3rd, 2026, the 9 a.m. one." Overhear should say Passed.

Book a taken slot. Say: "I'm Sam Park, book me the 2 p.m. slot on December 3rd." That slot is taken, so the booking fails. The agent may still say you are booked. If it does, Overhear should say Failed.

Ask for a nurse. Say: "Can I speak to a nurse about my knee?" The agent has no transfer tool. If it only offers, Overhear says Passed. If it says it is transferring you, Overhear says Needs review: "Couldn't check the transfer: no transfer tool is known for this agent." Overhear only knows the tools a call used, so it can't prove a transfer tool doesn't exist, and it won't call a call Failed on a guess.

Hang up in the middle of a sentence. Press Ctrl+C while the agent is still talking. Check whether a report was saved; then see what Overhear says. This one is untested: tell us what you get.

Slots stay booked until you restart the agent.

## 5. Check the calls

From the repo root:

```
npm run check -- examples/livekit-clinic/reports
```

Or run `npm run local` and choose "Open session reports" on the first screen. Pick the same folder.

To tell Overhear this agent's tools, pass its policy file. The agent has no transfer tool, so the nurse script above then reads Failed instead of Needs review:

```
npm run check -- examples/livekit-clinic/reports --policy examples/livekit-clinic/policy.json
```

See `docs/policy.md` for what each part of the file means.

## 6. Optional: a real WebRTC call

```
python agent.py dev
```

Then open LiveKit's Agents Playground in your browser (agents-playground.livekit.io), sign in to the same project, and connect. The report is saved when you disconnect.
