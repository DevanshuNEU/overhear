# LiveKit SessionReport cases

The five `livekit-*` cases in `eval/engine/cases/` hold records produced offline by the LiveKit Agents library (no LiveKit server, no audio, no API keys). They are `source: "generated"`: the output of the platform's own library from a script we wrote, not real calls. Each case's `record` is the library's JSON, unedited.

- livekit-agents 1.8.13, tag `livekit-agents@1.8.13`, commit `9ce5a1e151d3956d0f53da0ad1c02cc58cadd68b`
- Python 3.12
- Method: a text-only `AgentSession` with a scripted LLM (same shape as the library's `tests/fake_llm.py`) and real `@function_tool` functions, driven with `session.run(user_input=...)`. The report is built with `SessionReport(...)` using the same arguments as `JobContext.make_session_report` (`job.py`), then `json.dumps(report.to_dict())`. Nothing in the JSON is edited after the library writes it.
- The generator script is not in this repo. The facts about the format are in `docs/research/livekit-facts.md`.

Fields set by hand (inputs to the library, not edits of its output): `job_id="AJ_offline"`, `room_id="RM_offline"`, `room="offline-room"`, `agent_name=""` (there is no JobContext offline), and `duration = timestamp - started_at` (copied from make_session_report's own fallback when there is no recorder).

Scenarios, each the case of the same name with the prefix `livekit-`:

- `booking-success`: check_availability, then book_appointment returns a JSON string, the agent confirms.
- `booking-error-said-booked`: book_appointment raises `ToolError`, so the output has `is_error: true`; the scripted agent still says "you're booked".
- `transfer-no-tool`: the agent says "I'm transferring you to a nurse now" with no transfer tool anywhere.
- `caller-hung-up-mid-announcement`: the scripted agent streams the announcement slowly; 0.6 s in, the script calls `session._close_soon(reason=CloseReason.PARTICIPANT_DISCONNECTED)`, which is exactly the call `RoomIO._on_participant_disconnected` makes. It is a private method called by the script because there is no room offline. The real trigger (a SIP participant leaving with `CLIENT_INITIATED`) could not be produced without a LiveKit server.
- `interrupted-turn`: the agent streams a long answer; the script calls `session.interrupt()` mid-stream. In a real call this would be the caller talking over the agent; offline there is no audio, so the interruption is programmatic. The library sets `interrupted: true` itself.

Offline limits worth knowing: no TTS means `started_speaking_at` and `stopped_speaking_at` are LLM-stream times, not audio playback times; `llm_metadata` reads `unknown` because the LLM is a fake; the user message `created_at` is the time the text was submitted, not speech time (no STT).
