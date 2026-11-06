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
//
// The key leaves this module only through readKey, and only src/pull/retell-source.ts calls it (a test checks).
// Nothing here puts the key in an error: every error this module throws carries a fixed message or a file
// system error, which names a path and never the file's contents.
import { randomBytes } from "node:crypto";
import { constants, promises as fs, type Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_FILE = "config.json";
// Temp files from writeKey: `.config.json.<16 hex>.tmp`.
const TEMP_FILE = /^\.config\.json\.[0-9a-f]{16}\.tmp$/;

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

/** Printable ASCII with no spaces, 1 to 256 characters. Anything else is not a key and is never stored. */
export function isKeyShaped(key: string): boolean {
  return /^[\x21-\x7e]{1,256}$/.test(key);
}

type ConfigFile = { retellApiKey: string };

const errno = (err: unknown) => (err as NodeJS.ErrnoException).code;

/** True when `stat` belongs to another user. Where there are no uids (Windows), nothing is another user's. */
function ownedByOther(stat: Stats): boolean {
  const uid = process.getuid?.();
  return uid !== undefined && stat.uid !== uid;
}

/** Throws unless `dir` is a real directory, owned by this user, that no one else can open. */
async function checkHome(dir: string): Promise<void> {
  const stat = await fs.lstat(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new KeyStoreError("home_unsafe", `${dir} is not a directory. Set OVERHEAR_HOME to a directory of its own.`);
  }
  if (ownedByOther(stat)) {
    throw new KeyStoreError("home_unsafe", `${dir} is not yours (owned by uid ${stat.uid}). Set OVERHEAR_HOME to a directory you own.`);
  }
  if ((stat.mode & 0o077) !== 0) {
    const mode = (stat.mode & 0o777).toString(8);
    throw new KeyStoreError("home_unsafe", `${dir} is open to other users (mode ${mode}). Run chmod 700 on it, or set OVERHEAR_HOME to a new directory.`);
  }
}

/** Creates the directory 0700 when it is missing, then checks it. Never changes a directory it did not create. */
async function ensureHome(dir: string): Promise<void> {
  const created = await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (created !== undefined) await fs.chmod(dir, 0o700);
  await checkHome(dir);
}

/** Deletes temp files a crashed write left behind. Each could hold a key. */
async function removeTemps(dir: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (errno(err) === "ENOENT" || errno(err) === "ENOTDIR") return;
    throw err;
  }
  await Promise.all(names.filter((n) => TEMP_FILE.test(n)).map((n) => fs.rm(path.join(dir, n), { force: true })));
}

export async function writeKey(key: string): Promise<void> {
  if (typeof key !== "string" || !isKeyShaped(key)) throw new Error("That is not a Retell API key.");
  const dir = overhearHome();
  await ensureHome(dir);
  await removeTemps(dir);
  const target = path.join(dir, CONFIG_FILE);
  const temp = path.join(dir, `.${CONFIG_FILE}.${randomBytes(8).toString("hex")}.tmp`);
  const body: ConfigFile = { retellApiKey: key };
  // "wx" fails if the temp name exists, so this never writes through a planted file or symlink.
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(body) + "\n", "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.chmod(temp, 0o600);
    await fs.rename(temp, target);
  } catch (err) {
    await fs.rm(temp, { force: true });
    throw err;
  }
}

/**
 * The stored key, or null when there is none or the file is not one Overhear wrote. Throws KeyStoreError when the
 * file or its directory cannot be trusted: a symlink, not a plain file, not this user's, or not mode 0600.
 */
export async function readKey(): Promise<string | null> {
  const dir = overhearHome();
  let handle: FileHandle;
  try {
    // O_NOFOLLOW: a symlink at the file's place fails here (ELOOP) instead of being read through.
    handle = await fs.open(path.join(dir, CONFIG_FILE), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (err) {
    if (errno(err) === "ENOENT" || errno(err) === "ENOTDIR") return null;
    if (errno(err) === "ELOOP") throw new KeyStoreError("file_unsafe", `${path.join(dir, CONFIG_FILE)} is a symlink. Disconnect and paste the key again.`);
    throw err;
  }
  let text: string;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || ownedByOther(stat) || (stat.mode & 0o777) !== 0o600) {
      throw new KeyStoreError("file_unsafe", `${path.join(dir, CONFIG_FILE)} is not a 0600 file of yours. Disconnect and paste the key again.`);
    }
    await checkHome(dir);
    text = await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
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
  await removeTemps(dir);
}
