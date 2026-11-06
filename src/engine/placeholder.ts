// Redaction placeholders. A Retell call stored as everything_except_pii has its personal details replaced with
// text like "[person name 1]" or "[email 1]", in transcripts and in tool arguments and results. Such a value says
// nothing about what was committed, so the engine treats it as unresolved and never compares it.

// Letters, spaces and underscores in square brackets, with an optional number: "[person name 1]",
// "[date_of_birth_1]", "[PII INFO]". Lenient on purpose, since only two categories are documented. A false match
// makes a value unresolved, which can turn a result unverified but never violated.
const PLACEHOLDER = /\[[A-Za-z][A-Za-z _]*?(?:[ _]?\d+)?\]/;

/** True when a value is a string holding a redaction placeholder anywhere, so a partly scrubbed value counts too. */
export function isPlaceholder(value: unknown): boolean {
  return typeof value === "string" && PLACEHOLDER.test(value);
}
