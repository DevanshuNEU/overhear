// One batch of opened files in, the store updated, one list of what was set aside out. Each file is parsed, run through
// the engine's analyzeRecord (a Retell call or a LiveKit session report) with this machine's zone, and kept by its call
// id. Nothing a file contains is put in a problem: only its name and a fixed reason.
import { analyzeRecord } from "@/engine/analyze";
import { machineZone } from "@/pull/analyzer";
import { MAX_FILE_BYTES, type FileProblem, type ProblemReason } from "./labels";
import { addProblem, addReport } from "./store";

/** One file from the browser. `tooLarge` is the browser saying it did not read a file over the limit. */
export type OpenedFile = { name: string; text: string; tooLarge?: boolean };

const MAX_NAME = 120;

/** A file name safe to show: text only, no control characters, not too long. */
export function cleanName(name: unknown): string {
  const text = typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f]/g, "").trim() : "";
  if (text === "") return "Unnamed file";
  return text.length > MAX_NAME ? `${text.slice(0, MAX_NAME)}...` : text;
}

/** Reads each file and stores what the engine makes of it. Returns the files that were set aside, in order. */
export function ingestFiles(files: OpenedFile[]): FileProblem[] {
  const set: FileProblem[] = [];
  const skip = (file: string, reason: ProblemReason) => {
    addProblem(file, reason);
    set.push({ file, reason });
  };
  for (const opened of files) {
    const file = cleanName(opened.name);
    if (opened.tooLarge || Buffer.byteLength(opened.text, "utf8") > MAX_FILE_BYTES) {
      skip(file, "too_large");
      continue;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(opened.text);
    } catch {
      skip(file, "not_json");
      continue;
    }
    const outcome = analyzeRecord(raw, { tz: machineZone() });
    if (outcome.kind === "report") {
      if (addReport(file, outcome.report) === "full") skip(file, "list_full");
    } else if (outcome.kind === "no_content") {
      skip(file, "no_transcript");
    } else {
      skip(file, outcome.callId === null ? "not_a_report" : "not_checked");
    }
  }
  return set;
}
