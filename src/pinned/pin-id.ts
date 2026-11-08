// The pin id: the only source of a pinned file's name. It is built from the call id but holds nothing a path can
// use: lowercase letters, digits and single hyphens, so it always matches the eval case id rule and never carries
// a slash, a dot or a control character. The hash tail keeps "Call_A" and "call_a" (same slug) apart.
import crypto from "node:crypto";

const PREFIX = "pin-";
const SLUG_MAX = 48;
const FALLBACK = "call";

/** The slug: lowercase, every run outside a-z and 0-9 one hyphen, hyphens trimmed, at most 48 characters. */
function slugOf(callId: string): string {
  const flat = callId.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  // Trim again after the cut, so a cut that lands on a hyphen cannot leave "--" before the hash.
  const slug = flat.replace(/^-+|-+$/g, "").slice(0, SLUG_MAX).replace(/-+$/g, "");
  return slug === "" ? FALLBACK : slug;
}

/** `pin-<slug>-<first 8 hex of sha256(callId)>`: at most 61 characters, always a valid case id. */
export function pinIdFor(callId: string): string {
  const hash = crypto.createHash("sha256").update(callId, "utf8").digest("hex").slice(0, 8);
  return `${PREFIX}${slugOf(callId)}-${hash}`;
}
