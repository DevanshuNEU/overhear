// Every word the files routes say that a person reads, and the limits they hold. The routes answer with a code, and the
// words come from here, so nothing a file contains is ever repeated back. Real apostrophes, no dashes. No Node APIs, so
// the browser checks the same limits with the same sentences.

export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
/** Calls the store holds. */
export const MAX_CALLS = 500;
/** What one request may weigh before it is read at all: the total, plus room for the JSON around it and its escapes. */
export const MAX_BODY_BYTES = 64 * 1024 * 1024;

export type FilesError = "bad_request" | "too_many_files" | "too_large_total" | "failed";

export const FILES_MESSAGE: Record<FilesError, string> = {
  bad_request: "Overhear couldn’t read that request. Open the files again.",
  too_many_files: `Open ${MAX_FILES} files or fewer at a time.`,
  too_large_total: "Those files add up to more than 50 MB. Open fewer of them at a time.",
  failed: "Overhear couldn’t read those files. Try again.",
};

/** Why one file was set aside. */
export type ProblemReason = "not_json" | "not_a_report" | "too_large" | "not_checked" | "no_transcript" | "list_full";

export const PROBLEM_REASON: Record<ProblemReason, string> = {
  not_json: "Not JSON.",
  not_a_report: "Not a session report.",
  too_large: "Too large, 5 MB is the most.",
  not_checked: "Couldn’t be checked.",
  no_transcript: "No transcript to check.",
  list_full: `Not added, Overhear holds ${MAX_CALLS} calls at most.`,
};

export type FileProblem = { file: string; reason: ProblemReason };
