// The pasted Retell key, kept on this computer in `~/.overhear/config.json` (OVERHEAR_HOME moves the directory;
// the tests use it so they never touch the real one).
// - The directory must be a real directory (not a symlink), owned by this user, and closed to everyone else
//   (0700). Overhear creates it 0700. It never changes the mode of a directory it did not create: it refuses
//   with a clear message instead, so `OVERHEAR_HOME=$HOME` cannot chmod a home directory.
// - The file is 0600. A write goes to a fresh temp file that is then renamed into place, so a crash never leaves
//   half a key, and a symlink planted at the file's place is replaced rather than written through. Writing and
//   disconnecting both delete temp files a crashed write left behind, so no copy of the key survives disconnect.
// - readKey opens the file without following a symlink, and refuses one that is not a plain 0600 file owned by
//   this user.
// The folder and file rules live in src/local-store/private-dir.ts, shared with pinned calls.
//
// The key leaves this module only through readKey, and only src/pull/retell-source.ts calls it (a test checks).
// Nothing here puts the key in an error: every error this module throws carries a fixed message or a file
// system error, which names a path and never the file's contents.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensurePrivateDir, PrivateStoreError, readPrivateFile, removeTemps, tempNamePattern, writePrivateFile } from "@/local-store/private-dir";

const CONFIG_FILE = "config.json";
// Temp files from writeKey: `.config.json.<16 hex>.tmp`.
const TEMP_FILE = tempNamePattern(CONFIG_FILE);

export type KeyStoreErrorCode = "home_unsafe" | "file_unsafe";

/** The store refused a directory or a file it could not trust. The message says what to do; it never holds the key. */
export class KeyStoreError extends Error {
  constructor(
    readonly code: KeyStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "KeyStoreError";
  }
}

/** The directory that holds the key: OVERHEAR_HOME when it is an absolute path, else ~/.overhear. */
export function overhearHome(env: Record<string, string | undefined> = process.env): string {
  const override = env.OVERHEAR_HOME;
  if (override && path.isAbsolute(override)) return override;
  return path.join(os.homedir(), ".overhear");
}

export function configPath(env: Record<string, string | undefined> = process.env): string {
  return path.join(overhearHome(env), CONFIG_FILE);
}

/** The key file's path for a person to read: the home folder written as ~. */
export function displayConfigPath(env: Record<string, string | undefined> = process.env): string {
  const file = configPath(env);
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;
}

/** Printable ASCII with no spaces, 1 to 256 characters. Anything else is not a key and is never stored. */
export function isKeyShaped(key: string): boolean {
  return /^[\x21-\x7e]{1,256}$/.test(key);
}

type ConfigFile = { retellApiKey: string };

/** The shared helpers throw PrivateStoreError; this module's callers know KeyStoreError, with the same message. */
async function asKeyStoreError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof PrivateStoreError) throw new KeyStoreError(err.code === "dir_unsafe" ? "home_unsafe" : "file_unsafe", err.message);
    throw err;
  }
}

export async function writeKey(key: string): Promise<void> {
  if (typeof key !== "string" || !isKeyShaped(key)) throw new Error("That is not a Retell API key.");
  const dir = overhearHome();
  await asKeyStoreError(() => ensurePrivateDir(dir));
  await removeTemps(dir, TEMP_FILE);
  const body: ConfigFile = { retellApiKey: key };
  await writePrivateFile(dir, CONFIG_FILE, JSON.stringify(body) + "\n");
}

/**
 * The stored key, or null when there is none or the file is not one Overhear wrote. Throws KeyStoreError when the
 * file or its directory cannot be trusted: a symlink, not a plain file, not this user's, or not mode 0600.
 */
export async function readKey(): Promise<string | null> {
  const dir = overhearHome();
  const text = await asKeyStoreError(() => readPrivateFile(path.join(dir, CONFIG_FILE), { hint: "Disconnect and paste the key again." }));
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // The parser's message quotes the text it read, which is the key. Never let it out.
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const key = (parsed as Partial<ConfigFile>).retellApiKey;
  return typeof key === "string" && isKeyShaped(key) ? key : null;
}

export async function hasKey(): Promise<boolean> {
  return (await readKey()) !== null;
}

/** Deletes the key file and any temp file a crashed write left behind. Fine when there is none. */
export async function removeKey(): Promise<void> {
  const dir = overhearHome();
  await fs.rm(path.join(dir, CONFIG_FILE), { force: true });
  await removeTemps(dir, TEMP_FILE);
}
