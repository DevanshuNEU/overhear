# What is "Jev"? Research findings

Research date: 2026-09-22. The user referred by voice to a tool called "Jev", spelling uncertain
(speech-to-text). This document identifies it and assesses fit for a voice-AI-agent + LLM-as-judge
QA project (context: Retell AI, voice call-center agents).

## Identification

**Confidence: high.** "Jev" is spelled exactly that way. It is not a garbled homophone. Jev is a
real, recently launched AI model, and the name, timing, and domain (AI agents / voice AI / LLM
applications) all match the user's description.

**Jev** is a proprietary "System One" decision model from **TypeSafe AI**, a San Francisco lab
founded by Diogo Almeida, a co-author of the InstructGPT paper behind ChatGPT. It launched in
limited early access on **15 September 2026** — roughly one week before the research date, matching
the user's "past week or two" claim.
- Launch coverage: https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/
- Official docs: https://docs.typesafe.ai/introduction

No credible alternate candidate exists. Other September 2026 launches (Genesys Cloud AVA, Salesforce
Agentforce named agents, Wavespace "Beyond the Chatbox") do not phonetically match "Jev" and are not
one-syllable names. See sources at bottom.

## 1. What it is, in one sentence

Jev is TypeSafe AI's non-text "System One" model that takes a *state* (a transcript, message, or
structured object) plus typed *questions* and returns structured decisions directly — with
calibrated probabilities and confidence — instead of generating prose.
- https://docs.typesafe.ai/introduction
- https://vercel.com/i/what-is-jev

## 2. When it launched (confirmed recent)

- Limited early access released **15 September 2026**, alongside a reported seed round.
  https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/
- TechCrunch (18 Sep 2026) describes it as launched "this week."
- Confirmed recent. It is genuinely new — days old at time of research — which is both the appeal and
  the risk.

## 3. Problem it solves and core capabilities

Almeida's framing: LLMs optimize for human language, which "is not useful for automation because
computers speak a different language."
(https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/)

Jev exposes three primitives, all callable in a single request and evaluated in parallel and in
isolation (https://docs.typesafe.ai/introduction):
- **Choice** — select one option from a fixed menu; returns the choice with probabilities/confidence.
- **Score** — grade against an ordered rubric; returns a score with probabilities/confidence.
- **Noul (Boolean)** — estimate probability of true, returned as a 0–1 value.

Key properties:
- Does not generate free text, so it **cannot hallucinate outputs outside the predefined answer set**.
  https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/
- Very low latency — roughly **70–500 ms** per call (secondary sources / vendor material).
- Cost model: output tokens free, input tokens metered in bulk; vendor launch material lists roughly
  **$0.042 per million input tokens**.
  https://www.kucoin.com/news/flash/jev-model-sparks-global-developer-frenzy-with-fast-low-cost-decision-making
- Vendor/early-adopter speed and cost claims (treat as marketing until independently verified):
  "up to 193.6x faster and 444.6x cheaper than LLMs" on TypeSafe's own evals
  (https://www.scriptbyai.com/jev-resource-list/); a Vercel engineer reported 5–18x faster than
  "ChatGPT Luna 5.6"; a Bryo AI CTO reported 10–20x cheaper than Gemini for email classification
  (https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/).
- Design guidance: keep questions atomic and narrow; decompose complex evaluations into separate
  questions and recombine in code. https://docs.typesafe.ai/introduction

Design intent: it is a classifier/scorer/gate, **not** a conversational generator. It pairs with a
chat LLM for anything that must produce words.

## 4. API / SDK and how to integrate

**Yes — first-class TypeScript/Node support.** The primary integration path is Vercel's AI SDK 7 via
the AI Gateway:
- Access through the **experimental `evaluate` API** (`experimental_evaluate`), added in
  **AI SDK 7.0.105+**. https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk
- Model ID: **`typesafe-ai/jev`**. https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
- Install: `pnpm add ai@latest`; import `experimental_evaluate as evaluate`.
  https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
- A call specifies `model`, a `state` (string/object/array to evaluate), and a `questions` map of
  named typed decisions. Returns answers plus probabilities directly.
  https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk

Other documented access routes (breadth, not all primary):
- Official docs and `llms.txt` at https://docs.typesafe.ai/
- LiteLLM passthrough: https://docs.litellm.ai/docs/pass_through/typesafe
- Cloudflare AI models catalog: https://developers.cloudflare.com/ai/models/typesafe/jev/
- AI/ML API: https://docs.aimlapi.com/api-references/decision-models/typesafe/jev
- Community SDK ports beyond JS/TS reported (PHP, Swift, Scala). https://www.scriptbyai.com/jev-resource-list/

For a Node/TypeScript project, integration is straightforward: install AI SDK 7, set the AI Gateway
key, and call `evaluate({ model: 'typesafe-ai/jev', state, questions })`.

## 5. How it could plug into a voice-AI-agent + LLM-as-judge QA project

Strong fit, and notably fit as the **judge/eval layer** — the exact center of an LLM-as-judge QA
project. From TypeSafe's own positioning and a voice-focused write-up:
- **LLM-judge replacement / QA scoring at 100% coverage.** Jev scores transcripts against rubrics
  with far lower variance than LLM judges, cheaply and fast enough to grade every call rather than a
  sample. A voice-agent write-up cites "quality-score variance 92–913x lower than GPT-5.6 Luna,
  Terra, and Claude Sonnet 4.6 as judges... averaging 0.44s and $0.00035 per call."
  https://www.evalgent.com/blog/jev-voice-agent-use-cases (vendor-adjacent blog — verify claims)
- **Policy/compliance and hallucination checks.** Noul questions verify disclosures were read
  (e.g., mini-Miranda) and whether transcript claims are grounded in retrieved context — directly
  useful QA assertions. https://www.evalgent.com/blog/jev-voice-agent-use-cases
- **Runtime guardrails and routing** (if the project also touches the live agent): intent routing
  (Choice over a fixed menu), risk gating before irreversible actions (Noul "is this safe?"),
  jailbreak/injection detection per turn, confidence-gated human escalation, and turn-by-turn
  frustration scoring. https://www.evalgent.com/blog/jev-voice-agent-use-cases
- **Agent-loop control** more generally: choosing the next tool/subagent, deciding continue/retry/
  ask/stop, scoring urgency, verifying outputs and enforcing guardrails.
  https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk

Recommended role for this project: use Jev as the **deterministic, calibrated LLM-as-judge / eval
scorer** over Retell call transcripts (Score for rubric grading, Noul for pass/fail compliance
assertions, Choice for failure-category classification), and keep a chat LLM only for generating the
written QA report/rationale. Jev does not produce prose or explanations, so it does not replace the
narrative layer — that is a limitation to design around, not a blocker.

Where it is a **poor fit**: it is not a voice layer (no STT/TTS, no dialog generation) and not a
conversational LLM. It sits beside Retell (voice) and a chat model (generation), not in place of them.

## 6. Maturity / risk for a 2-week portfolio project

- **Very new** (days old, limited early access as of the launch). Expect API churn — it is an
  *experimental* AI SDK API (`experimental_evaluate`), so signatures may change.
  https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk
- **Integration maturity is good for TS/Node** thanks to the AI SDK + AI Gateway path, plus
  LiteLLM/Cloudflare routes — low integration effort.
- **Access risk:** "limited early access" may mean gated availability or waitlists; confirm you can
  actually get an API key before committing the project's core to it.
  https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/
- **Claims are largely vendor-sourced.** The dramatic speed/cost/variance numbers come from TypeSafe
  and vendor-adjacent blogs; independent benchmarks are not yet established. For a portfolio piece,
  that is fine if framed as "evaluated an emerging tool" with your own measurements.
- **Verdict:** Reasonable and even differentiating for a 2-week portfolio project, *if* used as one
  component (the eval/judge layer) with an LLM-judge fallback for resilience — not as an
  irreplaceable dependency. The novelty is a plus for a portfolio; the immaturity is a risk to
  hedge with a fallback and your own small benchmark.

## Sources

Primary / high-trust:
- TechCrunch launch coverage: https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/
- Official docs (Introduction): https://docs.typesafe.ai/introduction  and index https://docs.typesafe.ai/
- Vercel changelog (AI Gateway availability): https://vercel.com/changelog/typesafe-ai-jev-now-available-on-ai-gateway
- Vercel KB guide (classify/route/score with Jev + AI SDK): https://vercel.com/kb/guide/typesafe-jev-and-ai-sdk
- Vercel explainer: https://vercel.com/i/what-is-jev  and agent-control https://vercel.com/i/jev-agent-control
- Cloudflare AI models: https://developers.cloudflare.com/ai/models/typesafe/jev/
- LiteLLM passthrough: https://docs.litellm.ai/docs/pass_through/typesafe
- AI/ML API docs: https://docs.aimlapi.com/api-references/decision-models/typesafe/jev

Secondary / vendor-adjacent (claims to verify independently):
- Voice-agent use cases: https://www.evalgent.com/blog/jev-voice-agent-use-cases
- Resource list / speed-cost claims: https://www.scriptbyai.com/jev-resource-list/
- Pricing flash: https://www.kucoin.com/news/flash/jev-model-sparks-global-developer-frenzy-with-fast-low-cost-decision-making
- LangChain harness write-up: https://www.langchain.com/blog/building-a-harness-with-jev

Candidates considered and rejected (not phonetic matches, not one-syllable, or not new voice/agent
tooling): Genesys Cloud AVA, Salesforce Agentforce named agents, Wavespace "Beyond the Chatbox".
Source for September 2026 launch landscape: https://blog.mean.ceo/ai-product-launches-news-september-2026/
