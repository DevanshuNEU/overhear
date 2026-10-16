// Builds the Retell LLM + Agent config objects used both by the manual
// `provision:agent` script (real API calls, run by hand) and by tests (pure
// functions, no network). Keep `env` access lazy (inside functions) so this
// module can be imported without a fully-populated process.env.
import { env } from "@/lib/env";
import type { ToolName } from "@/domain/types";
import { DEMO_PERSONAS } from "@/demo/personas";

interface JsonSchemaObject {
  type: "object";
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}

export interface RetellCustomTool {
  type: "custom";
  name: ToolName;
  description: string;
  url: string;
  method: "POST";
  speak_during_execution: true;
  execution_message_description: string;
  parameters: JsonSchemaObject;
}

export interface RetellLlmConfig {
  begin_message: string;
  general_prompt: string;
  general_tools: RetellCustomTool[];
}

export interface RetellAgentConfig {
  response_engine: { type: "retell-llm"; llm_id: string };
  voice_id: string;
  webhook_url: string;
  boosted_keywords: string[];
  stt_mode: "accurate";
  enable_backchannel: true;
  backchannel_frequency: number;
  enable_dynamic_responsiveness: true;
}

// Placeholder ElevenLabs voice id - a warm, neutral default. Confirm a real,
// currently-available voice id against the Retell dashboard/API at live
// provisioning time (voice catalogs change); swap this constant then.
const PLACEHOLDER_VOICE_ID = "11labs-Adrian";

const TOOL_SPECS: Array<{
  name: ToolName;
  kebab: string;
  description: string;
  // What the agent says while the tool runs. Short and spoken, like a person
  // glancing at a screen, so the gap does not come out as stilted fragments.
  filler: string;
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}> = [
  {
    name: "check_availability",
    kebab: "check-availability",
    filler: 'Something short like "Let me take a look." or "One sec, pulling up the schedule."',
    description: "Look up open appointment slots, optionally filtered by provider name and/or date. Call this before offering any slot to the caller.",
    properties: {
      providerName: { type: "string", description: "Filter to a specific provider's full name, e.g. \"Dr. Lee\". Omit to search all providers." },
      date: { type: "string", description: "Filter to a specific calendar date in YYYY-MM-DD format. Omit to search all dates." },
    },
    required: [],
  },
  {
    name: "verify_patient",
    kebab: "verify-patient",
    filler: 'Something short like "Okay, let me find you." or "One moment while I pull up your file."',
    description: "Verify a caller's identity by their full name and date of birth. Must succeed before booking, rescheduling, or cancelling any appointment.",
    properties: {
      name: { type: "string", description: "The patient's full legal name as given by the caller." },
      dob: { type: "string", description: "The patient's date of birth in YYYY-MM-DD format." },
    },
    required: ["name", "dob"],
  },
  {
    name: "book_appointment",
    kebab: "book-appointment",
    filler: 'Something short like "Great, booking that now."',
    description: "Book an appointment for a verified patient into a specific open slot. Only call after verify_patient has succeeded and the slot came from check_availability.",
    properties: {
      patientId: { type: "string", description: "The patientId returned by a successful verify_patient call." },
      slotId: { type: "string", description: "The id of the open slot returned by check_availability." },
    },
    required: ["patientId", "slotId"],
  },
  {
    name: "reschedule_appointment",
    kebab: "reschedule-appointment",
    filler: 'Something short like "Okay, moving that for you now."',
    description: "Move an existing booked appointment to a different open slot. Only call after verify_patient has succeeded for the patient who owns the appointment.",
    properties: {
      appointmentId: { type: "string", description: "The id of the existing booked appointment to move." },
      newSlotId: { type: "string", description: "The id of the new open slot returned by check_availability." },
    },
    required: ["appointmentId", "newSlotId"],
  },
  {
    name: "cancel_appointment",
    kebab: "cancel-appointment",
    filler: 'Something short like "Okay, cancelling that now."',
    description: "Cancel an existing booked appointment. Only call after verify_patient has succeeded for the patient who owns the appointment.",
    properties: {
      appointmentId: { type: "string", description: "The id of the existing booked appointment to cancel." },
    },
    required: ["appointmentId"],
  },
];

export function buildLlmConfig(appUrl: string): RetellLlmConfig {
  const general_tools: RetellCustomTool[] = TOOL_SPECS.map((spec) => ({
    type: "custom",
    name: spec.name,
    description: spec.description,
    url: `${appUrl}/api/tools/${spec.kebab}`,
    method: "POST",
    speak_during_execution: true,
    execution_message_description: spec.filler,
    parameters: { type: "object", properties: spec.properties, required: spec.required },
  }));

  const begin_message = "Hi, thanks for calling Northwind Family Clinic, this is Riley. How can I help you today?";

  const general_prompt = [
    "You are Riley, the receptionist at Northwind Family Clinic. You're on a live phone call.",
    "You help callers check appointment availability, and book, reschedule, or cancel appointments.",
    "",
    "How you talk:",
    "- Sound like a real person at a front desk, not a script. Use contractions and everyday words: \"sure\", \"got it\", \"no problem\", \"okay, perfect\".",
    "- Keep each turn to one or two short sentences, then let the caller talk. Ask one thing at a time; never stack several questions in one turn.",
    "- Say dates and times the way people do: \"Thursday the 16th at 9 a.m.\", not \"2026-10-16T09:00\". Never read out ids, codes, or tool names.",
    "- When there are several options, offer two or three at most and ask which works, instead of listing everything.",
    "- Don't over-apologise or repeat yourself word for word. If something goes wrong, say so plainly and move on.",
    "- If the caller interrupts or changes their mind, go with it.",
    "- When the caller is done, wrap up like a person would: a quick recap of what's booked, then \"anything else?\" and a warm goodbye.",
    "",
    "Getting the caller's details:",
    "- Ask for their full name first, then their date of birth, as two separate questions.",
    "- Then read both back in one natural sentence and wait for a yes, e.g. \"Just to make sure I've got it right, that's Maria Lopez, born March 3rd, 1990?\"",
    "- If they correct you, or the name sounds unusual or unclear, ask them to spell their first and last name, then read the spelling back once.",
    "- Only call verify_patient once the caller confirms the name and date of birth are right. Pass the name exactly as confirmed and the date as YYYY-MM-DD.",
    "- When verify_patient succeeds, it returns patientName, the name on file. Use that name from then on; it is the correct spelling even if you heard it differently.",
    "- Whenever the caller gives new or spelled-out details, call verify_patient again with them. Never tell the caller you couldn't verify them unless verify_patient just returned verified: false for exactly those details.",
    "- If verify_patient returns verified: false, do not ask the same question again. Say you might have misheard, ask them to spell their name, and re-check the date of birth. Give it one more try; if it still fails, explain kindly that you can't find their file and suggest they call back or come by the front desk.",
    "",
    "Guardrails you must always follow:",
    "- Verify the caller's identity (full name and date of birth) using verify_patient BEFORE calling book_appointment, reschedule_appointment, or cancel_appointment. Never skip this verification step.",
    "- Before booking, rescheduling, or cancelling, say what you're about to do and get a yes.",
    "- Never give medical advice of any kind, even if asked directly. If a caller asks a medical question, politely decline and offer to connect them with a nurse instead.",
    "- Only ever offer or book appointment slots that were actually returned by check_availability. Never invent, assume, or guess a slot, provider, or time that check_availability did not return.",
  ].join("\n");

  return { begin_message, general_prompt, general_tools };
}

export function buildAgentConfig(llmId: string): RetellAgentConfig {
  return {
    response_engine: { type: "retell-llm", llm_id: llmId },
    voice_id: PLACEHOLDER_VOICE_ID,
    webhook_url: `${env.APP_URL}/api/webhooks/retell`,
    // Bias the transcriber toward the demo personas' names; uncommon names
    // otherwise come through as near-misses that fail verify_patient.
    boosted_keywords: [...new Set(DEMO_PERSONAS.flatMap((p) => p.name.split(" ")))],
    stt_mode: "accurate",
    // Light "mm-hm" / "got it" while the caller talks, and turn-taking that
    // adapts to how fast they speak.
    enable_backchannel: true,
    backchannel_frequency: 0.6,
    enable_dynamic_responsiveness: true,
  };
}
