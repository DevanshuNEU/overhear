// The pin store: pinned calls on this computer, one file per call in `$OVERHEAR_HOME/pinned/` (default
// `~/.overhear/pinned/`). A pinned call can hold names, dates of birth and health details, so the rules are strict.
// - The home folder and `pinned/` must each be a real directory (not a symlink), owned by this user, closed to others
//   (0700). Overhear creates a missing one 0700 and never changes the mode of one it did not create.
// - The folder is refused when it, or any folder above it, holds a `.git`: call data must not land in a repo by accident.
// - A file is 0600, written through a temp file renamed into place (a planted symlink is replaced, never written
//   through) and read without following a symlink, at most 5 MB.
// - File names come only from pinIdFor. A request-supplied id must match a strict shape and a file in the folder.
// - A listing never throws for one bad file: it names the file and says why in a fixed sentence, never what it held.
//
// No call content reaches an error, a problem or a log. This module imports nothing that reads the key or reaches the
// network (src/pinned/boundaries.test.ts checks).
import { promises as fs } from "node:fs";
import path from "node:path";
import { EvalCaseSchema, formatCase, parseCase, type EvalCase } from "@/engine/eval/case";
import { overhearHome } from "@/local-store/home";
import { checkDirIdentity, checkPrivateDir, ensurePrivateDir, PrivateStoreError, readPrivateFile, removeTemps, writePrivateFile } from "@/local-store/private-dir";
import { pinIdFor } from "./pin-id";

const FOLDER = "pinned";
/** A pin file: `pin-<anything>.json`. Other names in the folder are not ours and are never touched. */
const PIN_FILE = /^pin-.+\.json$/;
/** The temp files a write leaves if it crashes: `.pin-<id>.json.<16 hex>.tmp`. */
const PIN_TEMP = /^\.pin-[a-z0-9-]+\.json\.[0-9a-f]{16}\.tmp$/;
/** An id a request may name. Looser than a real pin id on purpose: it is only a gate before the folder is read. */
const REQUEST_ID = /^pin-[a-z0-9-]{1,64}$/;

/** At most this many pins are kept or listed. */
export const MAX_PINS = 500;
/** A pin file over this many bytes is neither written nor read. */
export const MAX_PIN_BYTES = 5 * 1024 * 1024;

export type PinStoreErrorCode = "in_repo" | "invalid_pin" | "too_many" | "too_large" | "bad_id" | "not_found" | "not_a_file";

/** The store refused a pin, an id or a folder. The message says what to do and never holds call content. */
export class PinStoreError extends Error {
  constructor(
    readonly code: PinStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PinStoreError";
  }
}

/** One file in the folder that could not be used: its name and a fixed sentence. Never what it held. */
export type PinProblem = { file: string; message: string };

export type PinEntry = { id: string; pin: EvalCase };

export type PinListing = { pins: PinEntry[]; problems: PinProblem[] };

/** A file name for a message: a name on disk can hold escape sequences, so anything but plain characters becomes "?". */
const shown = (name: string): string => name.replace(/[^\x21-\x7e]/g, "?").slice(0, 100);

const errno = (err: unknown) => (err as NodeJS.ErrnoException).code;
const isGone = (err: unknown) => errno(err) === "ENOENT" || errno(err) === "ENOTDIR";

/** The folder pinned calls live in. */
export function pinnedDir(env: Record<string, string | undefined> = process.env): string {
  return path.join(overhearHome(env), FOLDER);
}

/** True when `dir` holds a `.git` (a folder in a checkout, a file in a worktree). Unsure counts as yes. */
async function holdsGit(dir: string): Promise<boolean> {
  try {
    await fs.lstat(path.join(dir, ".git"));
    return true;
  } catch (err) {
    if (isGone(err)) return false;
    return true;
  }
}

/** `target` with the symlinks in its existing part resolved, so a missing folder is judged by where it would really land. */
async function resolvedWhereItWouldBe(target: string): Promise<string> {
  const missing: string[] = [];
  let here = path.resolve(target);
  for (;;) {
    try {
      return path.join(await fs.realpath(here), ...missing.reverse());
    } catch (err) {
      const up = path.dirname(here);
      if (!isGone(err) || up === here) return path.resolve(target);
      missing.push(path.basename(here));
      here = up;
    }
  }
}

/** Throws when `start` or any folder above it holds a `.git`, up to the filesystem root. */
async function refuseInRepo(start: string): Promise<void> {
  let here = path.resolve(start);
  for (;;) {
    if (await holdsGit(here)) {
      throw new PinStoreError("in_repo", `${here} holds a .git, so pinned calls are not kept under it. Set OVERHEAR_HOME to a folder outside any git repository.`);
    }
    const up = path.dirname(here);
    if (up === here) return;
    here = up;
  }
}

type Access = "write" | "read" | "delete";

/**
 * The checked pinned folder, or null when there is none to read or delete from.
 * - write: creates missing folders 0700, then requires both to be private. Refuses a git repo.
 * - read: requires both to be private. Refuses a git repo. Null when missing.
 * - delete: requires both to be real directories of yours, whatever their mode, so a delete works after a mode loosened
 *   but never follows a symlink. It does not look for a git repo: removing call data must never be blocked.
 * The home folder is checked before `pinned/` is created or used inside it, so OVERHEAR_HOME=$HOME is refused, not used.
 */
async function openFolder(access: Access): Promise<string | null> {
  const home = path.resolve(overhearHome());
  const dir = path.join(home, FOLDER);
  if (access !== "delete") {
    await refuseInRepo(dir);
    // Before anything is created: a symlink above a missing folder can lead into a repo.
    await refuseInRepo(await resolvedWhereItWouldBe(dir));
  }
  if (access === "write") {
    await ensurePrivateDir(home);
    await ensurePrivateDir(dir);
  } else {
    const check = access === "read" ? checkPrivateDir : checkDirIdentity;
    try {
      await check(home);
      await check(dir);
    } catch (err) {
      if (isGone(err)) return null;
      throw err;
    }
  }
  // The same check on the real path, in case a folder above is a symlink into a repo.
  if (access !== "delete") await refuseInRepo(await fs.realpath(dir));
  return dir;
}

const pinNames = async (dir: string): Promise<string[]> => (await fs.readdir(dir)).filter((n) => PIN_FILE.test(n)).sort();

/**
 * Saves one pinned call. The pin is checked as a whole first (parseCase), its id must be the one pinIdFor gives its call
 * id, and its record must carry that call id: a failed trim leaves an empty record, which is refused here. The file is the
 * case's canonical text (formatCase). Returns the pin's id.
 */
export async function savePin(pin: EvalCase): Promise<{ id: string }> {
  let valid: EvalCase;
  try {
    valid = parseCase(pin, "the pin");
  } catch (err) {
    throw new PinStoreError("invalid_pin", err instanceof Error ? err.message : "The pin is not a valid case.");
  }
  if (valid.pin === undefined) throw new PinStoreError("invalid_pin", "The case has no pin block, so it is not a pinned call.");
  if (typeof valid.record.call_id !== "string" || valid.record.call_id === "") {
    throw new PinStoreError("invalid_pin", "The pin's record has no call_id, so nothing was kept.");
  }
  if (valid.id !== pinIdFor(valid.pin.callId)) throw new PinStoreError("invalid_pin", "The pin's id is not the one its call id gives.");
  const name = `${valid.id}.json`;
  const text = formatCase(valid);
  if (Buffer.byteLength(text, "utf8") > MAX_PIN_BYTES) {
    throw new PinStoreError("too_large", `That call is bigger than ${MAX_PIN_BYTES} bytes, so it was not kept.`);
  }

  const dir = (await openFolder("write")) as string;
  const names = await pinNames(dir);
  if (names.length >= MAX_PINS && !names.includes(name)) {
    throw new PinStoreError("too_many", `${MAX_PINS} calls are already pinned. Delete some before pinning more.`);
  }
  // openFolder just checked the folder, which is what makes the clean-up safe.
  await removeTemps(dir, PIN_TEMP);
  await refuseDirectoryAt(path.join(dir, name), name);
  await writePrivateFile(dir, name, text);
  return { id: valid.id };
}

/** A directory planted at a pin's name cannot be renamed over or deleted as a file: say so, plainly. */
async function refuseDirectoryAt(file: string, name: string): Promise<void> {
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (err) {
    if (isGone(err)) return;
    throw err;
  }
  if (stat.isDirectory()) throw new PinStoreError("not_a_file", `${name} is a folder, not a pinned call. Move it out of the pinned folder.`);
}

/** The first few places in a pin file that failed the schema, as paths only. A message could echo a value. */
function issuePaths(raw: unknown): string {
  const parsed = EvalCaseSchema.safeParse(raw);
  if (parsed.success) return "";
  const paths = [...new Set(parsed.error.issues.map((i) => i.path.map(String).join(".") || "(root)"))];
  return paths.slice(0, 5).join(", ");
}

/** The pin in one file, or the fixed sentence that says why it cannot be used. null when the file vanished. */
async function readOne(dir: string, name: string): Promise<{ entry: PinEntry } | { problem: string } | null> {
  const file = path.join(dir, name);
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (err) {
    if (isGone(err)) return null;
    throw err;
  }
  if (!stat.isFile()) return { problem: "is not a plain file, so it was not read" };
  let text: string | null;
  try {
    text = await readPrivateFile(file, { hint: "", maxBytes: MAX_PIN_BYTES });
  } catch (err) {
    if (err instanceof PrivateStoreError && err.code === "file_unsafe") return { problem: "is not a 0600 file of yours, so it was not read" };
    if (err instanceof PrivateStoreError && err.code === "file_too_large") return { problem: "is bigger than 5 MB, so it was not read" };
    if (err instanceof PrivateStoreError) throw err;
    return { problem: "could not be read" };
  }
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // The parser's message can quote the text. Never let it out.
    return { problem: "is not valid JSON" };
  }
  const parsed = EvalCaseSchema.safeParse(raw);
  if (!parsed.success) return { problem: `is not a valid pin (check: ${issuePaths(raw)})` };
  const pin = parsed.data;
  if (pin.pin === undefined) return { problem: "is a case but not a pinned call" };
  if (name !== `${pin.id}.json`) return { problem: "has a name that is not its pin id" };
  if (pinIdFor(pin.pin.callId) !== pin.id) return { problem: "has an id that its call id does not give" };
  if (pin.record.call_id !== pin.pin.callId) return { problem: "holds a record of a different call" };
  return { entry: { id: pin.id, pin } };
}

/**
 * Every pin in the folder, and a problem for each file that cannot be used. Never throws for one bad file. Throws only
 * when the folder itself cannot be trusted (PrivateStoreError, PinStoreError). At most 500 files are read; more is a
 * problem. Names that are not `pin-*.json` are ignored.
 */
export async function listPins(): Promise<PinListing> {
  const dir = await openFolder("read");
  if (dir === null) return { pins: [], problems: [] };
  const names = await pinNames(dir);
  const pins: PinEntry[] = [];
  const problems: PinProblem[] = [];
  for (const name of names.slice(0, MAX_PINS)) {
    const one = await readOne(dir, name);
    if (one === null) continue;
    if ("entry" in one) pins.push(one.entry);
    else problems.push({ file: shown(name), message: `${shown(name)} ${one.problem}.` });
  }
  if (names.length > MAX_PINS) problems.push({ file: `${FOLDER}/`, message: `The folder holds ${names.length} pin files. Only the first ${MAX_PINS} were read.` });
  return { pins, problems };
}

/** Removes one entry by name, without following a symlink: a link is unlinked, never its target. */
async function removeEntry(dir: string, name: string): Promise<"removed" | "folder" | "gone"> {
  const file = path.join(dir, name);
  // The name came from a listing of this folder or passed the id check, so the join must stay inside it.
  if (path.dirname(file) !== dir) throw new PinStoreError("bad_id", "That is not a pinned call.");
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (err) {
    if (isGone(err)) return "gone";
    throw err;
  }
  if (stat.isDirectory()) return "folder";
  try {
    await fs.unlink(file);
  } catch (err) {
    if (isGone(err)) return "gone";
    throw err;
  }
  return "removed";
}

/**
 * Deletes one pin. `id` is checked against `^pin-[a-z0-9-]{1,64}$` and must name a pin file that is in the folder, so
 * a request cannot reach any other path. A folder planted at the pin's name is refused with a clear error. A symlink
 * there is removed itself, never followed.
 */
export async function deletePin(id: string): Promise<void> {
  if (typeof id !== "string" || !REQUEST_ID.test(id)) throw new PinStoreError("bad_id", "That is not a pinned call id.");
  const dir = await openFolder("delete");
  const name = `${id}.json`;
  if (dir === null || !(await pinNames(dir)).includes(name)) throw new PinStoreError("not_found", "No pinned call has that id.");
  const result = await removeEntry(dir, name);
  if (result === "folder") throw new PinStoreError("not_a_file", `${name} is a folder, not a pinned call, so it was left alone. Remove it yourself.`);
  if (result === "gone") throw new PinStoreError("not_found", "No pinned call has that id.");
  await removeTemps(dir, PIN_TEMP);
}

/**
 * Deletes every pin file. A folder planted at a pin's name is skipped and reported, not crashed on. Other files in the
 * folder are not touched. Returns how many were deleted.
 */
export async function deleteAllPins(): Promise<{ deleted: number; skipped: PinProblem[] }> {
  const dir = await openFolder("delete");
  if (dir === null) return { deleted: 0, skipped: [] };
  let deleted = 0;
  const skipped: PinProblem[] = [];
  for (const name of await pinNames(dir)) {
    const result = await removeEntry(dir, name);
    if (result === "removed") deleted += 1;
    if (result === "folder") skipped.push({ file: shown(name), message: `${shown(name)} is a folder, not a pinned call, so it was left alone.` });
  }
  await removeTemps(dir, PIN_TEMP);
  return { deleted, skipped };
}
