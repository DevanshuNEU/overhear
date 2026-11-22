// The team's own policy (docs/policy.md): `policy.json` in the Overhear folder (OVERHEAR_HOME, default ~/.overhear).
// The local dashboard's analyzers read it for every call. The hosted demo never does.
//
// The file follows the key store's folder-safety rules (src/local-store/private-dir.ts), minus the secrecy ones: a
// policy is not a secret, so it may be 0644, but it decides what counts as Failed, so it must not be writable by
// anyone else. The folder must be a real directory (not a symlink) owned by this user and not writable by others. The
// file is opened without following a symlink, must be a plain file owned by this user, not writable by others, and
// at most MAX_POLICY_BYTES.
//
// A file that is there but unusable is ignored: the call is checked with the preset or an inferred policy, as if no
// file existed. The one thing logged is a fixed sentence, never the file's contents, and only when the problem is new.
import fs from "node:fs";
import path from "node:path";
import { PolicySchema, type Policy } from "@/report/schema";
import { isLocalMode } from "@/pull/local";
import { overhearHome } from "./home";

export const POLICY_FILE = "policy.json";
export const MAX_POLICY_BYTES = 256 * 1024;

/** What is logged when the file is there and cannot be used. Fixed: it never holds anything from the file. */
export const IGNORED_POLICY_SENTENCE = "Overhear ignored policy.json in the Overhear folder because it is not a valid policy. See docs/policy.md.";

/** The text of a policy file turned into a Policy, or the problems in plain words, one per line. */
export function parsePolicyText(text: string): { policy: Policy } | { problems: string[] } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { problems: ["it is not valid JSON"] };
  }
  const parsed = PolicySchema.safeParse(json);
  if (parsed.success) return { policy: parsed.data };
  return {
    problems: parsed.error.issues.map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "the policy"}: ${issue.message}`),
  };
}

function ownedByOther(stat: fs.Stats): boolean {
  const uid = process.getuid?.();
  return uid !== undefined && stat.uid !== uid;
}

/** The file's text, or null when it is missing or cannot be trusted ("unsafe" says which, without any content). */
function readSafe(file: string): { text: string } | "missing" | "unsafe" {
  try {
    const dir = fs.lstatSync(path.dirname(file));
    if (dir.isSymbolicLink() || !dir.isDirectory() || ownedByOther(dir) || (dir.mode & 0o022) !== 0) return "unsafe";
  } catch {
    return "missing";
  }
  let fd: number;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unsafe";
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || ownedByOther(stat) || (stat.mode & 0o022) !== 0 || stat.size > MAX_POLICY_BYTES) return "unsafe";
    return { text: fs.readFileSync(fd, "utf8") };
  } catch {
    return "unsafe";
  } finally {
    fs.closeSync(fd);
  }
}

let lastWarning: string | null = null;

/**
 * The policy in the Overhear folder, or undefined: no file, a hosted copy, or a file that cannot be used (logged once
 * with IGNORED_POLICY_SENTENCE). Read at each call, so an edit takes effect on the next call.
 */
export function loadLocalPolicy(env: Record<string, string | undefined> = process.env, log: (line: string) => void = console.warn): Policy | undefined {
  if (!isLocalMode(env)) return undefined;
  const read = readSafe(path.join(overhearHome(env), POLICY_FILE));
  if (read === "missing") {
    lastWarning = null;
    return undefined;
  }
  const parsed = read === "unsafe" ? null : parsePolicyText(read.text);
  if (parsed !== null && "policy" in parsed) {
    lastWarning = null;
    return parsed.policy;
  }
  if (lastWarning !== IGNORED_POLICY_SENTENCE) log(IGNORED_POLICY_SENTENCE);
  lastWarning = IGNORED_POLICY_SENTENCE;
  return undefined;
}
