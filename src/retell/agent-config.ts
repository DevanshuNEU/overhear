// Builds the Retell LLM + Agent config objects used both by the manual
// `provision:agent` script (real API calls, run by hand) and by tests (pure
// functions, no network). Keep `env` access lazy (inside functions) so this
// module can be imported without a fully-populated process.env.
import { env } from "@/lib/env";
import type { ToolName } from "@/domain/types";

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
  parameters: JsonSchemaObject;
}

export interface RetellLlmConfig {
  general_prompt: string;
  general_tools: RetellCustomTool[];
}

export interface RetellAgentConfig {
  response_engine: { type: "retell-llm"; llm_id: string };
  voice_id: string;
  webhook_url: string;
}

// Placeholder ElevenLabs voice id — a warm, neutral default. Confirm a real,
// currently-available voice id against the Retell dashboard/API at live
// provisioning time (voice catalogs change); swap this constant then.
const PLACEHOLDER_VOICE_ID = "11labs-Adrian";

const TOOL_SPECS: Array<{
  name: ToolName;
  kebab: string;
  description: string;
  properties: Record<string, { type: string; description: string }>;
  required: string[];
}> = [
  {
    name: "check_availability",
    kebab: "check-availability",
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
    parameters: { type: "object", properties: spec.properties, required: spec.required },
  }));

  const general_prompt = [
    "You are Riley, the friendly phone receptionist for Northwind Family Clinic.",
    "You help callers check appointment availability, and book, reschedule, or cancel appointments.",
    "",
    "Guardrails you must always follow:",
    "- Verify the caller's identity (full name and date of birth) using verify_patient BEFORE calling book_appointment, reschedule_appointment, or cancel_appointment. Never skip this verification step.",
    "- Never give medical advice of any kind, even if asked directly. If a caller asks a medical question, politely decline and offer to connect them with a nurse instead.",
    "- Only ever offer or book appointment slots that were actually returned by check_availability. Never invent, assume, or guess a slot, provider, or time that check_availability did not return.",
    "- Keep responses concise and warm, as a real receptionist would on the phone.",
  ].join("\n");

  return { general_prompt, general_tools };
}

export function buildAgentConfig(llmId: string): RetellAgentConfig {
  return {
    response_engine: { type: "retell-llm", llm_id: llmId },
    voice_id: PLACEHOLDER_VOICE_ID,
    webhook_url: `${env.APP_URL}/api/webhooks/retell`,
  };
}
