// src/judge/narrator.ts - per-call QA prose summary. Separate from the Judge
// adapters (claude-judge.ts, jev-judge.ts): those score dimensions, this
// turns already-scored dimensions into one short paragraph a human can read
// without opening the transcript. Mirrors ClaudeJudge's client setup (lazy
// getClient, env.ANTHROPIC_API_KEY read inside the function, same model id).
import Anthropic from "@anthropic-ai/sdk";
import type { DimensionScore, FailureCategory } from "@/domain/types";
import { env } from "@/lib/env";

const MODEL = "claude-sonnet-5";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  return (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }));
}

interface SummarizeInput {
  dimensions: DimensionScore[];
  failureCategories: FailureCategory[];
  transcriptText: string;
}

function describeDim(d: DimensionScore): string {
  return `- ${d.key} (${d.tier}): score ${d.score}, ${d.rationale}`;
}

function buildPrompt(input: SummarizeInput): string {
  const passed = input.dimensions.filter((d) => d.passed);
  const failed = input.dimensions.filter((d) => !d.passed);
  return [
    "You are writing a QA summary for one completed call handled by a scheduling assistant.",
    "Write exactly one short paragraph, 2 to 4 sentences, in plain prose with no headers or bullet points.",
    "State what went well, then state specifically what failed and why, grounded only in the",
    "dimensions and failure categories listed below. Do not invent details beyond what is given.",
    "",
    "Dimensions that passed:",
    passed.length ? passed.map(describeDim).join("\n") : "none",
    "",
    "Dimensions that failed:",
    failed.length ? failed.map(describeDim).join("\n") : "none",
    "",
    "Failure categories observed:",
    input.failureCategories.length ? input.failureCategories.join(", ") : "none",
    "",
    "Transcript, for context only, do not quote it verbatim:",
    input.transcriptText,
  ].join("\n");
}

async function _callModel(prompt: string): Promise<string> {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });
  const block = message.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error(`narrator: model did not return text (stop_reason=${message.stop_reason})`);
  }
  return block.text;
}

export async function summarizeCall(input: SummarizeInput): Promise<string> {
  return _callModel(buildPrompt(input));
}
