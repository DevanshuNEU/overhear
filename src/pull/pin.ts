// Pinning a call from the app: the one place a pin is made, and the only code that reads the stored key for one.
//
// A pin keeps a call's record on this computer, so the pull's rule (keep no raw records) bends here on purpose, once, for
// one call the user asked for. The steps, in order, each refusing before the next:
//   1. The body is checked (parsePinBody) and the call id matches the Retell id shape. Nothing reaches Retell before that.
//   2. The call is fetched again with the stored key, through the pull's shared limiter (fetchRecord).
//   3. The record is for the same call id, and the call has ended.
//   4. The record is trimmed to what the engine reads (minimizeRecord), then analyzed with this machine's zone and no
//      demo agent. Only a report can be pinned.
//   5. What the user kept is built from the fresh report. The keep lists are names only, so the client also sends `saw`,
//      required: the verdict and the result of each item it showed. The verdict and every kept item must equal the fresh
//      reading, and a kept name the report does not have is refused, or the pin is refused as changed. A pin is never
//      made from a reading the user did not see.
//   6. The pin is refused, and nothing written, when its text holds the stored key.
//   7. savePin writes it. The answer is the pin's id and nothing else.
// Every refusal is a PinErrorCode: a fixed sentence (PIN_MESSAGE), never a word of the call, the key or Retell's answer.
import { z } from "zod";
import { analyzeRetellCall } from "@/engine/analyze";
import { EXPERIENCE_EXPECTS, formatCase, PIN_NOTE_MAX, type EvalCase, type ExperienceExpect } from "@/engine/eval/case";
import { minimizeRecord } from "@/pinned/minimize";
import { pinIdFor } from "@/pinned/pin-id";
import { PinStoreError, savePin } from "@/pinned/store";
import { PrivateStoreError } from "@/local-store/private-dir";
import { CONTRACT_IDS, EXPERIENCE_CHECKS, RESULTS, VERDICTS, type ContractId, type ExperienceCheckId, type Result } from "@/report/schema";
import pkg from "../../package.json";
import { machineZone } from "./analyzer";
import { KeyStoreError } from "./key-store";
import type { PinErrorCode } from "./labels";
import { fetchRecord, type PullTuning } from "./pull";
import { CALL_ID } from "./report-source";
import { readStoredKey } from "./retell-source";

const KEEP_MAX = 16;

const SawSchema = z.strictObject({
  verdict: z.enum(VERDICTS),
  contracts: z.partialRecord(z.enum(CONTRACT_IDS), z.enum(RESULTS)),
  experience: z.partialRecord(z.enum(EXPERIENCE_CHECKS), z.enum(EXPERIENCE_EXPECTS)),
});

const BodySchema = z.strictObject({
  callId: z.string(),
  keep: z.strictObject({
    contracts: z.array(z.enum(CONTRACT_IDS)).max(KEEP_MAX),
    experience: z.array(z.enum(EXPERIENCE_CHECKS)).max(KEEP_MAX),
  }),
  note: z.string().max(PIN_NOTE_MAX * 4).optional(),
  saw: SawSchema,
});

export type PinInput = {
  callId: string;
  keep: { contracts: ContractId[]; experience: ExperienceCheckId[] };
  /** One line of plain text, at most 280 characters, control characters already gone. */
  note?: string;
  /** What the screen showed: the verdict, and a result for every kept contract and check. */
  saw: z.infer<typeof SawSchema>;
};

export type PinOutcome = { ok: true; id: string } | { ok: false; code: PinErrorCode };

const refuse = (code: PinErrorCode): { ok: false; code: PinErrorCode } => ({ ok: false, code });

// The characters a pinned call's note may not hold, as case.ts lists them (it does not export the list, to leave the
// engine's sources alone): C0 and C1 controls, DEL, line and paragraph separators, zero-width and direction marks, bidi
// embeddings, overrides and isolates, the byte order mark and the tag characters. A test keeps the two in step.
const CONTROLS = /[\u0000-\u001f\u007f-\u009f\u{200B}-\u{200F}\u{2028}-\u{202E}\u{2066}-\u{2069}\u{FEFF}\u{E0000}-\u{E007F}]/gu;

/** A note as one line of plain text: line breaks become spaces, every other control character goes, spaces collapse. */
function cleanNote(note: string): string {
  return note.replace(/[\r\n\u2028\u2029]+/g, " ").replace(CONTROLS, "").replace(/\s+/g, " ").trim();
}

/**
 * The pin request from a body's text: bad_call_id for an id that is not a Retell id, bad_request for anything else the
 * shape does not allow (an unknown keep name or field, a note over 280 characters). Pure, so nothing is fetched before it.
 */
export function parsePinBody(text: string): { ok: true; input: PinInput } | { ok: false; code: PinErrorCode } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse("bad_request");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return refuse("bad_request");
  const callId = (raw as { callId?: unknown }).callId;
  if (typeof callId !== "string" || !CALL_ID.test(callId)) return refuse("bad_call_id");
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) return refuse("bad_request");
  const { note, keep, saw } = parsed.data;
  const clean = note === undefined ? undefined : cleanNote(note);
  if (clean !== undefined && clean.length > PIN_NOTE_MAX) return refuse("bad_request");
  return {
    ok: true,
    input: {
      callId,
      keep: { contracts: [...new Set(keep.contracts)], experience: [...new Set(keep.experience)] },
      ...(clean ? { note: clean } : {}),
      saw,
    },
  };
}

/** Local time with its offset, as a case's label.at: `2026-11-08T10:15:00-05:00`. */
function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const minutes = -d.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return `${date}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Retell's agent version is a number; a pin keeps it as text, or null when there is none or it has an odd shape. */
function agentVersionOf(v: unknown): string | null {
  const text = typeof v === "number" && Number.isInteger(v) ? String(v) : typeof v === "string" ? v : null;
  return text !== null && /^[0-9A-Za-z._-]{1,64}$/.test(text) ? text : null;
}

/** True when the pin's file text holds the key, as it is or as JSON writes it (a quote or backslash in it is escaped). */
function holdsKey(pin: EvalCase, key: string): boolean {
  const escaped = JSON.stringify(key).slice(1, -1);
  return [formatCase(pin), JSON.stringify(pin)].some((text) => text.includes(key) || text.includes(escaped));
}

function fetchFailure(error: { status?: number; code: string }): PinErrorCode {
  if (error.status === 404) return "not_found";
  switch (error.code) {
    case "bad_key":
    case "rate_limited":
    case "retell_down":
    case "network":
      return error.code;
    case "cancelled":
      return "not_connected";
    default:
      return "network";
  }
}

/** The pin's failure as a code: the store's own refusals by kind, anything else as a plain failure. */
export function storeFailure(err: unknown): PinErrorCode {
  if (err instanceof PinStoreError) {
    switch (err.code) {
      case "in_repo":
      case "too_many":
      case "too_large":
      case "not_a_file":
        return err.code;
      case "not_found":
        return "no_such_pin";
      case "invalid_pin":
        return "unreadable";
      case "bad_id":
        return "bad_pin_id";
      default:
        return "failed";
    }
  }
  return err instanceof PrivateStoreError || err instanceof KeyStoreError ? "store_unsafe" : "failed";
}

/** Pins one call. Never throws: every way it can stop is a code. */
export async function pinCall(input: PinInput, deps: { tuning?: PullTuning; now?: Date } = {}): Promise<PinOutcome> {
  try {
    if (!CALL_ID.test(input.callId)) return refuse("bad_call_id");
    const key = await readStoredKey();
    if (key === null) return refuse("not_connected");

    const fetched = await fetchRecord(input.callId, key, deps.tuning);
    if (!fetched.ok) return refuse(fetchFailure(fetched.error));
    const raw = fetched.value;
    if (!isRec(raw) || raw.call_id !== input.callId) return refuse("mismatch");
    if (raw.call_status !== "ended") return refuse("not_ended");

    const trimmed = minimizeRecord(raw);
    if (!isRec(trimmed) || trimmed.call_id !== input.callId) return refuse("unreadable");
    // Retell's calls carry an agent id. A record without one, or with odd characters in it, is refused rather than guessed.
    const agentId = trimmed.agent_id;
    if (typeof agentId !== "string" || !CALL_ID.test(agentId)) return refuse("unreadable");
    const tz = machineZone();
    const outcome = analyzeRetellCall(trimmed, { tz });
    if (outcome.kind !== "report") return refuse("no_report");
    const { report } = outcome;

    const contractResult = new Map<ContractId, Result>(report.results.map((r) => [r.contract, r.result]));
    const ran = new Set(report.experience.ran);
    const experienceNow = (check: ExperienceCheckId): ExperienceExpect => (report.experience.problems.some((p) => p.check === check) ? "problem" : "clean");

    const contracts: Partial<Record<ContractId, Result>> = {};
    for (const name of input.keep.contracts) {
      const now = contractResult.get(name);
      if (now === undefined || input.saw.contracts[name] !== now) return refuse("changed");
      contracts[name] = now;
    }
    const experience: Partial<Record<ExperienceCheckId, ExperienceExpect>> = {};
    for (const name of input.keep.experience) {
      if (!ran.has(name) || input.saw.experience[name] !== experienceNow(name)) return refuse("changed");
      experience[name] = experienceNow(name);
    }
    if (input.saw.verdict !== report.verdict) return refuse("changed");

    const pin: EvalCase = {
      schemaVersion: 1,
      id: pinIdFor(input.callId),
      source: "real",
      independent: false,
      platform: "retell",
      locked: true,
      label: { by: "you", at: stamp(deps.now ?? new Date()), ...(input.note ? { note: input.note } : {}) },
      pin: { callId: input.callId, agentId, agentVersion: agentVersionOf(trimmed.agent_version), pinnedWith: pkg.version },
      tz,
      expect: { verdict: report.verdict, contracts, experience },
      record: trimmed,
    };
    if (holdsKey(pin, key)) return refuse("key_in_call");

    const { id } = await savePin(pin);
    return { ok: true, id };
  } catch (err) {
    // The store says why in a fixed sentence. Anything else (a thrown message can quote the call) is only "failed".
    return refuse(storeFailure(err));
  }
}
