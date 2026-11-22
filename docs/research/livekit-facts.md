# LiveKit Agents session report: primary-source facts

Research for a LiveKit Agents adapter in Overhear, which today reads Retell calls only.

- Compiled: 2026-11-21
- Pinned source: `livekit/agents` tag `livekit-agents@1.8.13`, commit `9ce5a1e151d3956d0f53da0ad1c02cc58cadd68b` (the latest 1.x release tag at compile time). Package installed from PyPI at the same version, Python 3.12.
- Node source: `livekit/agents-js`, `main` at commit `f5f9603c6c7f16a324b2187ba230d482a539efc8`, package `agents/package.json` version 1.10.1. No release tag was available in the shallow clone, so this is a commit pin.
- Other sources: `docs.livekit.io` pages, each cited by URL.
- Every claim is followed by a source. Paths starting `voice/`, `llm/`, `job.py` or `beta/` are under `livekit-agents/livekit/agents/` at the pinned tag. "Observed" means seen in a fixture produced by running the library offline (see "Fixtures").

## Fixtures

Five real report files were produced by the library, with no output edited by hand. They live outside the repo in `.context/livekit-fixtures/` (git ignored), with a README listing the command and the few inputs set by hand. Method: a text-only `AgentSession` with a scripted LLM shaped like `tests/fake_llm.py`, real `@function_tool` functions, `session.run(user_input=...)`, then a `SessionReport` built with the same arguments `JobContext.make_session_report` uses (`job.py`), then `json.dumps(report.to_dict())`.

| File | What it shows |
| --- | --- |
| `booking-success.json` | check_availability, book_appointment returns JSON, agent confirms |
| `booking-error-said-booked.json` | book_appointment raises `ToolError`, output has `is_error: true`, agent still says "you're booked" |
| `transfer-no-tool.json` | agent says "I'm transferring you to a nurse now", no tool exists, no function call in the history |
| `caller-hung-up-mid-announcement.json` | close event reason `participant_disconnected`, `close_reason` `CR_PARTICIPANT_DISCONNECTED`, the announcement message `interrupted: true` and cut off |
| `interrupted-turn.json` | assistant message with `interrupted: true` and truncated text |

Limits of offline fixtures. The hang-up fixture calls the private `session._close_soon(reason=CloseReason.PARTICIPANT_DISCONNECTED)`, which is the exact call `RoomIO._on_participant_disconnected` makes (`voice/room_io/room_io.py`), because there is no room offline. The real trigger, a SIP participant leaving, needs a LiveKit server. The interruption is programmatic (`session.interrupt()`), not a caller talking over the agent. With no TTS, `started_speaking_at` and `stopped_speaking_at` are LLM stream times rather than audio playback times, and `llm_metadata.model_name` reads `unknown` because the LLM is fake. Real audio timing needs a real call.

## 1. SessionReport and to_dict()

`SessionReport` is a dataclass (`voice/report.py`) with these fields: `job_id: str`, `room_id: str`, `room: str`, `options: AgentSessionOptions`, `events: list[AgentEvent]`, `chat_history: ChatContext`, `audio_recording_path: Path | None`, `audio_recording_started_at: float | None`, `duration: float | None`, `started_at: float | None`, `timestamp: float` (default `time.time()`), `model_usage: list[ModelUsage] | None`, `sdk_version: str`, `agent_name: str`, `tags: list[str]`.

`to_dict(include_chat_history=True, include_events=True)` returns these top-level keys, in this order (`voice/report.py`; all present in the fixtures):

| Key | Type | Notes |
| --- | --- | --- |
| `job_id` | string | LiveKit job id |
| `room_id` | string | room sid |
| `room` | string | room name |
| `events` | list of objects | each `event.model_dump()`; `metrics_collected` events are dropped; omitted if `include_events=False` |
| `audio_recording_path` | string or null | absolute path on the agent host, not a URL |
| `audio_recording_started_at` | number or null | epoch seconds |
| `options` | object | `allow_interruptions`, `discard_audio_if_uninterruptible`, `min_interruption_duration`, `min_interruption_words`, `min_endpointing_delay`, `max_endpointing_delay`, `max_tool_steps`, `user_away_timeout`, `min_consecutive_speech_delay`, `preemptive_generation`, `recording_options` |
| `chat_history` | object `{ "items": [...] }` | from `ChatContext.to_dict(exclude_timestamp=False)`; omitted if `include_chat_history=False` |
| `timestamp` | number | epoch seconds when the report was built, normally at session end |
| `usage` | list of objects or null | per model/provider usage summaries |
| `sdk_version` | string | `"1.8.13"` here |
| `agent_name` | string | the dispatch name, empty if none |
| `tags` | list of strings | from the job's Tagger, sorted |
| `duration_ms` | integer or null | `int(duration * 1000)` |
| `user_turns` | integer | count of user `ChatMessage` items |
| `errors` | object | always the five keys `llm`, `stt`, `tts`, `realtime`, `interruption`, each an integer count of `error` events |
| `close_reason` | string or null | proto enum name of the last `close` event's reason, for example `CR_PARTICIPANT_DISCONNECTED`; null with no close event |

The report carries no participant identity, no phone number and no SIP attributes. It has no per-call success flag; `tags` only holds whatever the developer set on the Tagger (`ctx.tagger.success(...)`, `ctx.tagger.fail(...)` per the docstring in `job.py`).

Observed: fixture JSON loads with plain `json.dumps` and no custom encoder, because `CloseReason` is a `str` Enum.

## 2. Chat items (`llm/chat_context.py`)

`chat_history.items` is a flat, chronologically ordered list of items, each with a `type`. `ChatContext.to_dict` dumps each with `model_dump(mode="json", exclude_none=True, exclude_defaults=False)`, so null fields are absent and defaults are present. Images and audio are dropped from messages by default (`llm/chat_context.py`, `to_dict`).

`ChatMessage` (`type: "message"`):
- `id: str`, `role` (`user`, `assistant`, `system`, `developer`), `content: list[ChatContent]` where `ChatContent` is `ImageContent | AudioContent | CacheBreakpoint | str`. After `to_dict` the text parts are plain strings in the list. Observed: `["I'm transferring you to a nurse now. Please hold."]`.
- `interrupted: bool` (default false), `transcript_confidence: float | None`, `extra: dict`, `created_at: float`, `metrics: MetricsReport`.
- `metrics` keys (all optional, `llm/chat_context.py` `MetricsReport`): `started_speaking_at`, `stopped_speaking_at`, `transcription_delay`, `end_of_turn_delay`, `on_user_turn_completed_delay`, `llm_node_ttft`, `llm_node_tps`, `llm_node_ttfs`, `tts_node_ttfb`, `playback_latency`, `e2e_latency`, `provider_request_ids`, `llm_metadata`, `tts_metadata`, `stt_metadata`. Observed on an assistant message: `started_speaking_at`, `stopped_speaking_at`, `llm_node_ttft`, `playback_latency`, `llm_metadata`.
- `text_content` and `raw_text_content` are Python properties, not serialised. Assistant text may contain `<expr/>` expressive tags; `text_content` strips them (`llm/chat_context.py`).

`FunctionCall` (`type: "function_call"`): `id`, `call_id: str`, `arguments: str` (a JSON string, not an object), `name: str`, `created_at: float`, `extra: dict`, `group_id: str | None`. Observed: `"arguments": "{\"date\": \"2026-12-03\"}"`.

`FunctionCallOutput` (`type: "function_call_output"`): `id`, `name: str` (default empty, filled by the session), `call_id: str`, `output: str`, `is_error: bool`, `created_at: float`, `reply_required: bool`. The output is always a string.

How `is_error` and `output` are set (`llm/utils.py`, `make_function_call_output`):
- Tool raises `ToolError`: `output` is the error message, `is_error: true`. Observed.
- Tool raises any other exception: `output` is the fixed text `"An internal error occurred"`, `is_error: true`.
- Tool raises `StopResponse`: `output` is empty, `is_error: false`, `reply_required: false`.
- Tool returns normally: `is_error: false`, whatever the return value is, stringified. A tool that returns the text "failed" or `{"status": "error"}` is `is_error: false`. So `is_error` reports only that the tool function raised, never that the business action failed.

`AgentHandoff` (`type: "agent_handoff"`): `id`, `old_agent_id: str | None`, `new_agent_id: str`, `created_at`. Observed as the first item in every fixture (`old_agent_id` absent, `new_agent_id: "default_agent"`).

`AgentConfigUpdate` (`type: "agent_config_update"`): `id`, `instructions`, `tools_added`, `tools_removed`, `created_at`. Observed as the second item in every fixture. The adapter must tolerate it; it is not a turn or a tool call.

Ordering inside the list: items are appended in time order. In the booking fixtures the assistant message "Let me check that day." precedes its `function_call`, then the `function_call_output`, then the next call, then the final message. A tool call's `created_at` is reset to the start of tool execution (`voice/agent_activity.py`, comments at "reset the created_at to the start time of the tool execution").

## 3. Events in the report, CloseEvent and CloseReason

`events` holds every event the session emitted except `metrics_collected` (`voice/agent_session.py` `emit` appends every event to `_recorded_events`; `voice/report.py` filters). The union (`voice/events.py`, `AgentEvent`): `user_state_changed`, `agent_state_changed`, `user_input_transcribed`, `user_transcription_timeout`, `agent_false_interruption`, `metrics_collected`, `session_usage_updated`, `conversation_item_added`, `function_tools_executed`, `speech_created`, `tool_execution_updated`, `error`, `close`, `overlapping_speech`. Every event has `type` and `created_at` (epoch seconds, default `time.time()`).

Events observed in the fixtures: `conversation_item_added` (holds the same item as the chat history), `agent_state_changed` (`initializing`, `listening`, `thinking`, `speaking`), `speech_created`, `tool_execution_updated`, `session_usage_updated`, `function_tools_executed`, `close`. No `error` event appeared because a `ToolError` is not a session error; `errors` counts stay zero. Events are not a second source of truth for the conversation, since `conversation_item_added` repeats the chat history.

`tool_execution_updated` carries `update.type` of `tool_call_started` (with the `function_call`), `tool_call_updated`, `tool_call_ended` or `tool_reply_updated` (`voice/events.py`). `tool_call_ended` has `call_id`, `message` and `status` of `done`, `error` or `cancelled`. Observed: the failed booking ends with `status: "error"` and the error text as `message`; the successful lookup ends with `status: "done"`.

`CloseEvent` has `type: "close"`, `reason: CloseReason`, `error` (an LLM, STT, TTS, realtime or interruption error object, or null) and `created_at` (`voice/events.py`).

`CloseReason` values: `error`, `job_shutdown`, `participant_disconnected`, `user_initiated`, `task_completed` (`voice/events.py`). In `to_dict` the report key `close_reason` maps them to proto names: `CR_ERROR`, `CR_JOB_SHUTDOWN`, `CR_PARTICIPANT_DISCONNECTED`, `CR_USER_INITIATED`, `CR_COMPLETED` (for `task_completed`) (`voice/report.py` `_close_reason_name`).

Which reason each ending produces at the pinned tag:
- Caller hangs up: `participant_disconnected`, set by `RoomIO._on_participant_disconnected` calling `_close_soon(reason=CloseReason.PARTICIPANT_DISCONNECTED)` (`voice/room_io/room_io.py`). This only happens when `close_on_disconnect` is on (the default) and the participant's `disconnect_reason` is in `DEFAULT_CLOSE_ON_DISCONNECT_REASONS`, which is `CLIENT_INITIATED`, `ROOM_DELETED` or `USER_REJECTED` (`voice/room_io/types.py`). A participant that leaves for any other reason does not close the session through this path. A report from a session that never closed on such a disconnect would carry another reason or none.
- Agent ends the call with the built-in `end_call` tool: the tool calls `ctx.session.shutdown()` (`beta/tools/end_call.py`), and `shutdown` closes with `USER_INITIATED` (`voice/agent_session.py`). So `user_initiated` means the agent or developer code closed the session, not that the user did. By default `end_call` also deletes the room (`delete_room=True`). Hence `user_initiated` plus an `end_call` function call is an agent hangup.
- `session.aclose()` called directly: also `USER_INITIATED` (`voice/agent_session.py`).
- Job shutdown callback: `job_shutdown` (`voice/agent_session.py`, registered with `job_ctx.add_shutdown_callback`).
- An unrecoverable LLM, STT or TTS error: `error`, with the `error` object on the close event (`voice/agent_session.py` `_on_error`).
- `task_completed`: defined, but the only code that would use it is commented out (`voice/agent.py`, "session._close_soon(reason=CloseReason.TASK_COMPLETED, drain=True)"). Nothing at 1.8.13 emits it.

Observed in `caller-hung-up-mid-announcement.json`: the assistant message is `"I'm transferring you to "` with `interrupted: true`, the last events are `agent_state_changed` speaking to listening and then `close` with `reason: "participant_disconnected"`, and the report has `close_reason: "CR_PARTICIPANT_DISCONNECTED"`. Closing without `drain` force-interrupts the speech in progress (`voice/agent_session.py` `_teardown_activity`), so a hang-up mid-sentence marks the sentence interrupted.

## 4. Timing

- All timestamps are Unix epoch seconds as floats (`time.time()`), in events, chat items, `timestamp`, `started_at` and `audio_recording_started_at` (`voice/events.py`, `llm/chat_context.py`, `voice/report.py`). Observed: `1795322056.400554`.
- `ChatMessage.created_at` for an assistant turn is the time the agent started speaking (`started_speaking_at`) when audio played, else the reply start (`voice/agent_activity.py`, `created_at=started_speaking_at ...`, `created_at=reply_started_at`). For a user turn heard through STT it is set to `turn_started_at`, the start of the user's speech (`voice/agent_activity.py`, `msg.created_at = ev.turn_started_at`). For typed input it is the submission time (observed).
- `metrics.started_speaking_at` and `stopped_speaking_at` give per-message start and end. A user message heard through STT also gets `metrics.started_speaking_at`.
- `started_at` is set when `AgentSession.start` runs (`voice/agent_session.py`, `self._started_at = time.time()`). It is not in the dict; only `duration_ms` is.
- `duration_ms = int(duration * 1000)`. `duration` is `timestamp - audio_recording_started_at` when audio was recorded, else `timestamp - started_at` (`job.py` `make_session_report`). The report `timestamp` is taken when the report is built, which is at session end. So call end is `timestamp` and call start is `timestamp - duration_ms / 1000`. With audio recording on, the start is the recording start, which can be slightly earlier than `started_at`. For the Node SDK, `duration_ms` is always `timestamp - startedAt` (`agents/src/voice/report.ts`).
- The first chat item is an `agent_handoff`, whose `created_at` is session start, not call connect. The report has no SIP call-answered time. Call start from the telephony side needs the LiveKit room or SIP call records, which are not in the report.

## 5. Transfers

- API: `TransferSIPParticipant` over the LiveKit server API; Python `api.sip.transfer_sip_participant(api.TransferSIPParticipantRequest(room_name, participant_identity, transfer_to, play_dialtone))` (`job.py`, `JobContext.transfer_sip_participant`). LiveKit sends a SIP REFER through the trunk (https://docs.livekit.io/telephony/features/transfers/cold/).
- There is no built-in transfer tool in livekit-agents for cold transfer. The docs show a developer-written `@function_tool() async def transfer_call(self, ctx: RunContext)` that finds the SIP participant, tells the user, calls the API, and returns the text `"could not transfer call"` on failure (https://docs.livekit.io/telephony/features/transfers/cold/). Its name is whatever the developer chooses; the docs example calls it `transfer_call`. Overhear cannot assume a name, so the mapping of "which function is the transfer" must come from the team's policy.
- Warm transfer exists as a beta workflow, `WarmTransferTask` (`beta/workflows/warm_transfer.py`), an `AgentTask` with its own tools `connect_to_caller`, `decline_transfer(reason)`, `voicemail_detected`. These are tools of the transfer task (the human agent's side), and the task result is `WarmTransferResult(human_agent_identity)`. Calling it from a tool starts an agent task, which appears as an `agent_handoff` item (`llm/chat_context.py` `AgentHandoff`) plus the tools above.
- Result of a cold transfer, per the docs: on success LiveKit ends its side, the caller leaves the room and the session ends; on failure the API errors (error metadata may include `sip_transfer_reason` such as `STR_REJECTED`, `STR_RINGING_TIMEOUT`, `STR_CALL_ENDED`) and the caller stays in the room (https://docs.livekit.io/telephony/features/transfers/cold/).
- What the report holds: a `function_call` item with the developer's tool name, a `function_call_output`, and a close event. A successful transfer is followed by the caller leaving, so the close reason is expected to be `participant_disconnected` if the disconnect reason is one of the three listed in section 3. That is inferred from the docs and the source, not observed, because it needs a SIP server. The report has no event for the REFER itself and no transfer status field. Whether a transfer succeeded is known only from the tool's output text (and `is_error` if the tool raised on failure).
- A transfer the agent only announces, with no tool called, leaves only an assistant message. Observed in `transfer-no-tool.json`: no `function_call` item and no event beyond the usual state changes. This is the said-versus-did gap Overhear is built to catch.
- One caution found in the source: in console or fake-job mode `transfer_sip_participant` is skipped with a warning and returns an empty `SIPParticipantInfo` (`job.py`), so a console test run can show a transfer call that never happened.

## 6. Getting reports out of production

- In the entrypoint, pass `on_session_end` to `rtc_session` when registering the entrypoint, and inside it call `ctx.make_session_report()` then `report.to_dict()`; the SDK calls it after the voice pipeline closes, so history is final; the callback is limited by `session_end_timeout`, default 5 minutes (https://docs.livekit.io/deploy/observability/data/). In Node the same is done from `ctx.addShutdownCallback` with `JSON.stringify` (same page).
- `make_session_report()` raises `RuntimeError` if no session exists or if the recorder is still recording (`job.py`). `to_dict()` makes no network request, so it works self-hosted (https://docs.livekit.io/deploy/observability/data/).
- Built-in upload: after the session, if recording options are enabled or the Tagger has evaluations or an outcome, the SDK uploads the report to LiveKit Cloud through `_upload_session_report` (`job.py` `_on_session_end`). In console record mode it also writes `session_report.json` locally (`job.py`). No built-in upload to a customer's own endpoint exists; the team must write the callback that POSTs the dict.
- LiveKit Cloud Agent Insights shows per-session transcripts with tool calls and handoffs marked, traces, logs, metrics and audio. Retention is 30 days by default. The dashboard Download data button gives a ZIP with `traces.json`, `logs.json`, `metrics.json`, `chat_history.json` and `audio.oga`. The docs say the CLI can list sessions with `lk analytics session list --user-auth`, and that the CLI and the LiveKit Cloud API return the same data (transcript, logs, traces, metrics, recording), both requiring the Admin role on the project (https://docs.livekit.io/testing/observability/insights.md). This contradicts our expectation that no listing API exists: the docs claim one. The REST endpoint, its auth and whether `chat_history.json` has the same shape as `to_dict()["chat_history"]` are not stated on that page. They were not verified against the CLI source or a real account.
- Live option: subscribe to `conversation_item_added` or `user_input_transcribed` (https://docs.livekit.io/deploy/observability/data/).
- Self-hosted LiveKit has no Insights; the team's own `on_session_end` is the only path.

## 7. Node SDK (`livekit/agents-js`)

The Node SDK has an equivalent report, but not the same wire shape by default. `agents/src/voice/report.ts` defines a camelCase `SessionReport` interface (`jobId`, `roomId`, `room`, `agentName`, `options`, `events`, `chatHistory`, `enableRecording`, `startedAt`, `timestamp`, `audioRecordingPath`, `audioRecordingStartedAt`, `duration`, `modelUsage`) and `JobContext.makeSessionReport()` (`agents/src/job.ts`). `sessionReportToJSON(report)` then emits snake_case keys intended to match Python: `job_id`, `room_id`, `room`, `events`, `audio_recording_path`, `audio_recording_started_at`, `options`, `chat_history`, `timestamp`, `usage`, `sdk_version`, `agent_name`, `duration_ms`, `user_turns`, `errors`, `close_reason`. Differences that matter: JS has an extra `enable_user_data_training` key; it has no `tags` key and no `min_consecutive_speech_delay` option; its in-memory `timestamp`, `startedAt` and `duration` are milliseconds, and it is not stated in `report.ts` whether the emitted `timestamp` is converted to seconds (the code passes `report.timestamp` through unchanged in `sessionReportToJSON`, so `timestamp` appears to be milliseconds in JSON, while chat item `created_at` is converted to Unix seconds by `chatHistoryToStandardJSON`); function call `args` is renamed to `arguments`; and the JS `CloseReason` enum has no `task_completed` (`agents/src/voice/events.ts`), though `closeReasonName` still maps the string to `CR_COMPLETED`. An adapter should read `timestamp` defensively (treat values above about 1e11 as milliseconds). The JS shape was read from source only; no JS fixture was generated.

## Mapping to Overhear's evidence

Read from `src/report/schema.ts` (`EvidenceSchema`, `ItemSchema`, `CallFieldsSchema`) and `src/engine/adapters/retell.ts`. The schema already lists `livekit` in `PLATFORMS`, and `platformOk` is documented as "LiveKit `!is_error`".

| Evidence part | LiveKit source | Consequence |
| --- | --- | --- |
| Turn text | `chat_history.items[]` where `type == "message"`, role `user` to `caller`, `assistant` to `agent`; text is the string entries of `content` joined by newline. Skip `system` and `developer` roles. | Present. Strip `<expr/>` tags from assistant text to match `text_content`. |
| Turn start time (`startSec`) | `metrics.started_speaking_at` (epoch seconds), falling back to `created_at`. Overhear's `startSec` for Retell is seconds from call start; LiveKit gives epoch seconds, so subtract call start. | Present, but call start is derived, see below. For typed (non-audio) sessions both are submission time. |
| `interrupted` | `ChatMessage.interrupted` (bool, always present). | Present and better than Retell's null. An interrupted message holds only the text that was actually forwarded or spoken (`voice/agent_activity.py`), so the claim text is what the caller heard. |
| Tool call id, name, args | `function_call.call_id`, `.name`, `json.loads(.arguments)` | Present. `arguments` is a JSON string; parse it like Retell's, with `{}` on failure. Use `call_id` as the Evidence `id`, not the item `id`. |
| Tool result payload | `function_call_output.output` (string), joined by `call_id`. Try `JSON.parse`, else keep text, as the Retell adapter does. | Present. Outputs for errors are the exception message or `"An internal error occurred"`. |
| Tool result `platformOk` | `!is_error` | Weak. It is true for every tool that returned without raising, including ones that returned an error body. Overhear's own success path (policy payload path, then backend action) must decide `ok`, as for Retell. A thrown error gives a reliable false. |
| Ordering | One flat list in time order, tool calls interleaved with messages. `ordering: "sequence"`. | Present, same quality as Retell's `transcript_with_tool_calls`. Parallel calls share `group_id`. |
| Events (the `event` item) | Items of type `agent_handoff` and `agent_config_update`, plus selected report `events` if wanted. | Chat items give everything for evidence. Report `events` mostly repeat the history and add state changes; leave them out except `close` (see below). `agent_handoff` and `agent_config_update` should become events so nothing is dropped, mirroring the Retell rule. |
| `callFields.disconnection_reason` | `close_reason` (`CR_*`), or the last `close` event's `reason`. | Present but with a different vocabulary and a weaker meaning. `CR_PARTICIPANT_DISCONNECTED` is a caller hang-up (only for three disconnect reasons). `CR_USER_INITIATED` is the agent or code ending the session, not the user. There is no value equal to Retell's `call_transfer`. The schema field is a free string, so it can carry the raw value. The engine's hang-up-during-announcement logic must be told that `participant_disconnected` is the hang-up signal and `user_initiated` is not. |
| `callFields.duration_ms` | `duration_ms` | Present, but it is session duration from `session.start`, or from audio recording start. Not the telephony call length. |
| `callFields.call_type` | none | Missing. Could be set to a constant such as `livekit_session`, or left out. Whether the call was SIP or web is not in the report. |
| `callFields.call_analysis` | none (only `tags`, which the developer sets) | Missing. Overhear already runs without it; nothing relies on Retell's `call_successful`. |
| `callStartMs` | `timestamp - duration_ms/1000`, times 1000 | Derived and approximate (see section 4). Null if `duration_ms` is null. |
| `callId` | `job_id` (stable per dispatch) or `room_id`/`room` | Present. `job_id` is the natural id; `room` names are often unique per call but not guaranteed. A transfer or a room reuse can make a room hold more than one session. |
| `agentVersion` | `sdk_version` is the library, not the agent. `agent_name` is the dispatch name. | Missing as a true agent version. Prompt or deployment version is not in the report. Use null, or `agent_name`. |
| Tool failure said as success | `is_error: true` with a later assistant message containing a success claim | Present and detectable from the report alone (`booking-error-said-booked.json`). |
| Announced transfer with no tool | assistant message with transfer wording and no `function_call` | Present (`transfer-no-tool.json`). The missing function call is the evidence. |
| Transfer happened | only a developer-named tool call and its output; success is not a field | Overhear's policy must name the transfer tool. A transfer that fails at SIP level only shows if the tool raises or returns an error text. |
| Backend actions | not in the report | Same as Retell: come from the team's own backend log, linked by `call_id`. LiveKit gives no tool call id to the backend unless the tool function forwards it; the `RunContext` carries `function_call` so a team can pass `call_id` along (`voice/events.py` `RunContext`). Without it, the fallback is name-and-args linking. |

## Open questions

1. Where does the report come from for a team? They must add an `on_session_end` hook that POSTs `to_dict()` to Overhear, or export from Cloud. The docs claim a CLI and API to list sessions (`lk analytics session list`), which would allow pull instead of push. Is the Cloud API's session payload the same as `to_dict()`, and what is the endpoint and token model? Verify against a real project before designing ingestion.
2. Which tool is the transfer? There is no built-in cold-transfer tool, so the name is the team's. Does the policy list it, or do we match on the `transfer_sip_participant` call? The report does not show the REFER call itself.
3. Is `success` knowable? `is_error` only means the tool raised. Tools that return an error body read as success. Do we accept the same payload-path policy as Retell for LiveKit, and should the adapter surface `platformOk` at all, or keep it null when the output looks like JSON?
4. Hang-up detection depends on the close reason, but only three disconnect reasons trigger `participant_disconnected`, and a session that is closed some other way (shutdown, room deletion by the agent's own `end_call`) gives `user_initiated`. How do we tell "caller left" from "agent ended" when the reason is `user_initiated` and there is an `end_call` tool call? Proposed: treat an `end_call` function call right before close as agent hangup. Needs a real SIP run to confirm what a SIP BYE produces as `disconnect_reason`.
5. Call start. Do we use `timestamp - duration_ms`, or ask teams to add a Tagger tag or room metadata with the real call start? Audio recording on shifts the start.
6. Report size. Events nearly double the file with state changes and repeated items. Should the adapter accept `to_dict(include_events=False)` and require only `chat_history` plus `close_reason`? The close reason survives only via `close_reason`, so `include_events=False` is safe.
7. Realtime models (speech to speech): the chat history is built differently, and a realtime session's tool calls and interruptions may carry different text and timing. Not tested here, since no fixture can be made without a model. Needs a real run.
8. Transcript text for audio sessions comes from STT or the model's own transcript and is `transcript_confidence`-scored. Do we show or use the confidence?
9. The Node `timestamp` unit in JSON and the `tags` and `enable_user_data_training` differences need a real Node report to confirm before supporting Node teams.
10. Multi-agent sessions: an `agent_handoff` item and per-agent tool sets mean one report may cover several agents. Is one report one Overhear call (yes under the current design), and do handoffs count as transfers for contract purposes?
11. PII: the report holds raw transcripts and tool arguments, and the library has a telemetry redaction path (`tests/test_telemetry_redaction.py`, whose effect on the report dict was not checked). Does Overhear need redacted input, and does redaction change the field shapes?
