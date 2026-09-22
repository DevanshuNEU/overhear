# Retell AI API — Primary-Source Facts

Research for a TypeScript/Next.js app that (1) creates a Retell voice agent for
healthcare appointment scheduling with custom function-calling tools that hit our
own API routes, (2) receives Retell webhooks to run an LLM-as-judge QA scorer on
the transcript, and (3) shows results in a dashboard.

- Compiled: 2026-09-22
- Sources: only `docs.retellai.com`, `github.com/RetellAI`, the `retell-sdk` npm
  package, and Retell's official pricing page. Every fact is followed by its
  source URL in parentheses.
- REST base URL: `https://api.retellai.com`; every request sends the API key as a
  bearer token in the `Authorization` header (https://docs.retellai.com/api-references/overview).

---

## 1. Webhook events

### Event types
Retell delivers webhook events to your server so you can react without polling.
The voice-call event types are:
- `call_started` — a new call begins.
- `call_ended` — call completion, transfer, or error (fires even if the call did
  not connect).
- `call_analyzed` — fires when call analysis finishes.
- `transcript_updated` — turn-taking updates and final call end.
- `transfer_started`, `transfer_bridged`, `transfer_cancelled`, `transfer_ended`
  — transfer lifecycle.
- Chat equivalents: `chat_started`, `chat_ended`, `chat_analyzed`.

A voice agent's default webhook events are `call_started`, `call_ended`,
`call_analyzed` (https://docs.retellai.com/features/webhook-overview).

### Payload shape
The webhook body is `{ "event": "<event_type>", "call": { ...call object... } }`.
The `call` object carries: `call_type`, `from_number`, `to_number`, `direction`,
`call_id`, `agent_id`, `call_status`, `metadata`, `retell_llm_dynamic_variables`,
`start_timestamp`, `end_timestamp`, `disconnection_reason`, `transcript`,
`transcript_object`, and `transcript_with_tool_calls`
(https://docs.retellai.com/features/webhook-overview).

Critical distinction for the QA scorer:
- `call_ended` includes all fields from the call object **except** `call_analysis`.
- `call_analyzed` includes the **full** call data including the `call_analysis`
  object. Listen to `call_analyzed` (not `call_ended`) to read `call_summary`,
  `user_sentiment`, `call_successful`, and custom extracted fields
  (https://docs.retellai.com/features/webhook-overview,
  https://docs.retellai.com/features/post-call-analysis-consumption).

### Fields available on the call object (from Get Call, the same schema the
webhook `call` object follows)
- `recording_url` — "Recording of the call. Available after call ends." Also
  `recording_multi_channel_url` and `scrubbed_recording_url` (PII removed).
- `public_log_url` — public log of all requests/responses during the call.
- `transcript` — plain-text conversation.
- `transcript_object` — array of utterance objects, each with:
  - `role`: `"agent"`, `"user"`, or `"transfer_target"`
  - `content`: the utterance text
  - `words`: array of `{ word, start, end }` (word-level timestamps)
- `transcript_with_tool_calls` — includes tool invocations and results (plus
  `scrubbed_transcript_with_tool_calls`).
- `call_analysis` object:
  - `call_summary` — high-level summary of the call.
  - `user_sentiment` — enum: `Positive`, `Negative`, `Neutral`, `Unknown`.
  - `call_successful` — boolean, task completion.
  - `in_voicemail` — boolean, voicemail detection.
  - `custom_analysis_data` — custom extraction per the agent's post-call schema.
- `latency` — objects keyed `e2e`, `llm`, `tts`, `asr`, `knowledge_base`, `s2s`,
  each with `p50`, `p90`, `p95`, `p99`, `min`, `max`, `num`, `values` (ms).
- `disconnection_reason` — enum incl. `user_hangup`, `agent_hangup`,
  `call_transfer`, `voicemail_reached`, `ivr_reached`, `inactivity`,
  `max_duration_reached`, `scam_detected`, `error_asr`, `error_retell`, and more.
- Cost: `product_costs[]` (`product`, `unit_price`, `cost` in cents),
  `total_duration_seconds`, `total_duration_unit_price`, `combined_cost` (cents)
(https://docs.retellai.com/api-references/get-call).

Note: custom post-call extraction fields are NOT populated for calls that never
connected or where no conversation took place
(https://docs.retellai.com/features/post-call-analysis-consumption).

### Webhook authenticity verification
- Signature header: `x-retell-signature`.
- Verify with the server SDK's `verify` method against the **raw** request body:
  - Node/TS: `Retell.verify(rawBody, process.env.RETELL_API_KEY, signature)`
  - Python: `retell.verify(raw_body, api_key=..., signature=...)`
- The docs warn: "Use raw body for signature verification, not
  `JSON.stringify(req.body)`." In Next.js this means reading the raw request body
  in the route handler before parsing
(https://docs.retellai.com/features/webhook-overview).

### Delivery semantics
Webhook POST has a 10-second timeout; if no 2xx is received within 10 seconds it
is retried up to 3 times (https://docs.retellai.com/features/webhook-overview).

---

## 2. Custom functions / tools (external HTTP calls)

A custom function tool lets the agent call your external API mid-call. Config
fields (single/multi-prompt agents):
- `name` — unique id, letters and underscores (e.g. `get_order_status`).
- `description` — clear description of what it does and when to use it.
- HTTP method — GET, POST, PUT, PATCH, or DELETE (defaults to POST).
- API endpoint URL — must be a publicly reachable URL.
- Timeout (ms) — 1000 to 600000 (defaults to 120000).
- Headers — static or dynamic-variable values.
- Query parameters — key/value pairs appended to the URL.
- Parameters (POST/PUT/PATCH) — request body defined as a JSON schema (or form
  editor).
- "Payload: args only" — toggle to send flat JSON (just `args` at top level) vs.
  the wrapped format.
- Response variables — extract JSON response fields into dynamic variables.
- "Talk While Waiting" (agent speech during execution).
- "Talk After Action Completed" (agent continues after the function returns).
- `max_retry` — 0 to 5 automatic retries on failure
(https://docs.retellai.com/build/single-multi-prompt/custom-function).

In the Retell LLM API these map to entries in `general_tools` with
`type: "custom"`, `name`, `description`, `url`, `method`, `parameters`,
`speak_during_execution`, `speak_after_execution`
(https://docs.retellai.com/api-references/create-retell-llm).

### Request Retell sends to your endpoint
For POST/PUT/PATCH, Retell sends JSON:
```json
{
  "name": "function_name",
  "call": { /* call context object */ },
  "args": { /* function arguments from the LLM */ }
}
```
Headers include `X-Retell-Signature` (HMAC-SHA256) and
`Content-Type: application/json`. With "Payload: args only" enabled, the body is
just the `args` object at the top level
(https://docs.retellai.com/build/single-multi-prompt/custom-function).

### Response your endpoint must return
Return an HTTP 2xx status (200–299). The response body can be a string, buffer,
JSON object, or blob — all are converted to a string before reaching the LLM.
Only JSON objects can populate response variables. Results are capped at 15,000
characters by default
(https://docs.retellai.com/build/single-multi-prompt/custom-function).

---

## 3. Agent + LLM config via API

A voice agent needs two resources: a Response Engine (the Retell LLM) and the
agent that references it
(https://docs.retellai.com/build/overview).

### Create Retell LLM
`POST https://api.retellai.com/create-retell-llm`. Key request body fields:
- `general_prompt` (string, nullable) — system prompt appended in all states.
- `model` (string, nullable) — text LLM (e.g. `gpt-5.6-terra`,
  `claude-4.5-sonnet`, `gemini-3.5-flash`). Defaults to `gpt-5.6-terra` if unset.
- `s2s_model` (string, nullable) — speech-to-speech model (e.g.
  `gpt-realtime-2.1`).
- `model_temperature` (number, [0,1], default 0), `model_high_priority`,
  `tool_call_strict_mode`.
- `start_speaker` (required, `"user"` or `"agent"`), `begin_message`,
  `begin_after_user_silence_ms`.
- `general_tools[]` — tools available in all states (custom tool fields:
  `type: "custom"`, `name`, `description`, `url`, `method`, `parameters`,
  `speak_during_execution`, `speak_after_execution`).
- `states[]` (with `starting_state` required if used),
  `default_dynamic_variables`, `knowledge_base_ids`, `mcps`, `is_transfer_llm`.

TS SDK: `await client.llm.create({ ... })`
(https://docs.retellai.com/api-references/create-retell-llm).

### Create Voice Agent
`POST https://api.retellai.com/create-agent`. Fields:
- Required: `response_engine` (`{ type: "retell-llm", llm_id: "..." }`) and
  `voice_id` (e.g. `"retell-Cimo"`).
- Common optional: `agent_name`, `webhook_url`, `language` (single locale or
  array; default `"en-US"`), `version_title`, `version_description`.
- Response is an `AgentResponse` with `agent_id` and `version`.

TS SDK:
```typescript
const agentResponse = await client.agent.create({
  response_engine: { type: 'retell-llm', llm_id: 'llm_...' },
  voice_id: 'retell-Cimo',
  agent_name: 'MyAgent',
  webhook_url: 'https://webhook-url-here',
  language: 'en-US',
});
```
(https://docs.retellai.com/api-references/create-agent).

Update agent: `Update Voice Agent`
(https://docs.retellai.com/api-references/update-agent).

---

## 4. Placing / receiving calls

### Web calls (easiest demo path — no phone number required)
Two components: a backend endpoint that mints credentials, and the browser SDK.
- Backend: `POST https://api.retellai.com/v3/create-web-call`. Required body:
  `agent_id`. Response (201): `call_id`, `access_token`, `transport` (`"gateway"`),
  `ice_servers[]`, `expires_at` (Unix epoch ms token expiry). TS SDK:
  `await client.call.createWebCall({ agent_id: '...' })`
  (https://docs.retellai.com/api-references/create-web-call).
- Browser SDK: package `retell-client-js-sdk`, class `RetellClient`. v3 usage
  takes a scoped **public key** and `agent_id` directly (rather than an
  access token):
  ```ts
  import { RetellClient } from "retell-client-js-sdk";
  const client = new RetellClient({ key: "public_key_..." });
  const call = client.createWebCall({
    agent_id: "agent_...",
    retell_llm_dynamic_variables: { customer_name: "Ada" },
    hooks: {
      onStatus: (status) => {},   // connecting -> live -> ended
      onEnd: ({ disconnection_reason }) => {},
      onError: (err) => {},
    },
  });
  await call.ready;   // settles when live
  call.mute(); call.unmute();
  await call.end();
  ```
  Pass `transcript: true` to also get `onTranscript` (full transcript list on
  every change), `onNodeTransition`, and `disconnection_reason` on `onEnd`;
  `transcript: true` needs a key with `Call.Write` scope, so it is off by default.
  The v2.x `RetellWebClient` (`startCall({ accessToken })`, events
  `agent_start_talking`/`agent_stop_talking`/`update`/`metadata`/`error`) "still
  ships and works unchanged" but is deprecated
  (https://github.com/RetellAI/retell-client-js-sdk,
  https://docs.retellai.com/deploy/web-call).

### Inbound / outbound phone calls
- Provision a Retell-managed number: `POST
  https://api.retellai.com/create-phone-number`. Body incl. `area_code` (3-digit
  int), `inbound_agents[]` / `outbound_agents[]` (each `agent_id`, `weight`,
  `agent_version`), `nickname`, `inbound_webhook_url`,
  `allowed_inbound_country_list`, `number_provider` (`twilio`|`telnyx`,
  default twilio), `country_code` (`US`|`CA`), `toll_free`. Response includes
  `phone_number` (E.164), `phone_number_pretty`, `phone_number_type`. TS SDK:
  `client.phoneNumber.create()`
  (https://docs.retellai.com/api-references/create-phone-number).
- Bind an inbound number to an agent via its inbound agent assignment; leave it
  unset to disable inbound. You can also import an existing Twilio/Telnyx number
  via `Import Phone Number`
  (https://docs.retellai.com/api-references/import-phone-number,
  https://docs.retellai.com/deploy/purchase-number).
- Outbound call: `POST https://api.retellai.com/v2/create-phone-call`. Required:
  `from_number` (E.164, owned/imported), `to_number` (E.164). Optional:
  `override_agent_id`, `metadata`, `retell_llm_dynamic_variables`. Response
  `call_id`, `agent_id`, `call_status` (registered|not_connected|ongoing|ended|
  error), `direction: "outbound"`, `call_type: "phone_call"`. TS SDK:
  `client.call.createPhoneCall({ from_number, to_number })`
  (https://docs.retellai.com/api-references/create-phone-call).

Minimum to get a testable call: create a Retell LLM, create an agent referencing
it, then either start a web call (no number needed) or provision a number and
call in/out.

---

## 5. Pricing / free tier

From the official pricing page (https://www.retellai.com/pricing):
- Free trial: "Go live in minutes with **$10 in free credits**."
- Base per-minute components:
  - Voice infrastructure: $0.055/min
  - Text-to-speech (Retell platform voices): $0.015/min
  - LLM: varies by model (e.g. GPT-tier ~ $0.080/min standard)
  - Telephony (US via Twilio): $0.015/min
- Concurrency: first 20 concurrent (active) calls free; extra capacity
  $8.00/concurrency/month.
- Phone number: $2.00/month (Retell number); verified number $10.00/number/month.
- Overall advertised range: ~$0.07–$0.31/min depending on configuration.

Impact on a 2-week demo: $10 free credit covers roughly 60–130 minutes of test
calls at typical stacked rates — ample for web-call demos and QA-scoring runs. A
phone number adds ~$2/month if you demo real inbound/outbound telephony; web
calls avoid that cost entirely.

---

## 6. TypeScript SDK

- Package: `retell-sdk` (server SDK). Install: `npm i retell-sdk`. Requires
  Node.js >= 18.10.0 (https://docs.retellai.com/get-started/sdk).
- Latest release noted during research: 5.66.1 (11 Sep 2026), published on npm
  and PyPI (https://docs.retellai.com/get-started/sdk).
- Init:
  ```typescript
  import Retell from 'retell-sdk';
  const retellClient = new Retell({ apiKey: "YOUR_API_KEY" });
  ```
- Minimal create-agent + web-call flow (server side):
  ```typescript
  import Retell from 'retell-sdk';
  const client = new Retell({ apiKey: process.env.RETELL_API_KEY });

  const llm = await client.llm.create({
    general_prompt: "You are a healthcare scheduling assistant...",
    // model, general_tools[], begin_message, start_speaker, etc.
  });

  const agent = await client.agent.create({
    response_engine: { type: 'retell-llm', llm_id: llm.llm_id },
    voice_id: 'retell-Cimo',
    webhook_url: 'https://your-app/api/retell/webhook',
  });

  const webCall = await client.call.createWebCall({ agent_id: agent.agent_id });
  // return webCall.access_token / webCall.call_id to the browser
  ```
- Browser web-call SDK: separate package `retell-client-js-sdk` (see section 4).
(https://docs.retellai.com/get-started/sdk,
https://docs.retellai.com/api-references/create-web-call).

---

## Confidence & gaps

Confirmed from primary sources (high confidence):
- Webhook event list, `{ event, call }` shape, and the `call_ended` vs
  `call_analyzed` distinction on `call_analysis` (webhook-overview).
- `x-retell-signature` header + `Retell.verify(rawBody, apiKey, signature)`
  raw-body requirement (webhook-overview).
- `transcript_object` structure (`role`, `content`, `words[{word,start,end}]`),
  `recording_url`, `call_analysis` subfields, `user_sentiment` enum
  (Positive/Negative/Neutral/Unknown), latency percentile fields,
  `disconnection_reason` enum (get-call).
- Custom function config fields, the `{ name, call, args }` request body, and the
  2xx/string/15,000-char response rules (custom-function).
- Create-retell-llm and create-agent request bodies and SDK methods.
- create-web-call (`/v3`), create-phone-call (`/v2`), create-phone-number
  endpoints and fields.
- `retell-sdk` install/init; `retell-client-js-sdk` v3 `RetellClient` usage
  (verified against the raw GitHub README).

Could NOT fully confirm / verify further before building:
- A complete, literal end-to-end sample webhook JSON payload: the
  register-webhook page showed only a placeholder `"transcript": "..."`. The
  field list above is assembled from webhook-overview + get-call, which share the
  call schema, but confirm the exact nesting of `call_analysis` inside the
  webhook `call` object against a live `call_analyzed` payload.
- Exact model id strings (`gpt-5.6-terra`, `claude-4.5-sonnet`,
  `gpt-realtime-2.1`, default LLM) came via doc-page summarization; verify the
  current `model` enum values against create-retell-llm before hardcoding.
- The browser SDK's exact public-key scoping/allowed-domains and reCAPTCHA setup
  for production; the README describes it but the security specifics for a
  healthcare context should be reviewed against docs/deploy/web-call.
- Whether the v3 browser SDK can instead consume the `access_token` from
  `createWebCall` (v2 pattern) — v3 README shows public-key + `agent_id`; the
  `access_token` return still exists, so both paths may work. Test which your
  Next.js setup should use.
- `retell-sdk` version 5.66.1 and the "latest release 11 Sep 2026" date came from
  a docs summary; run `npm view retell-sdk version` at build time for the exact
  current version.
- Free-credit-to-minutes math is an estimate derived from the per-minute
  components; actual burn depends on the chosen LLM and whether telephony is used.
