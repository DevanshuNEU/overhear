// Folder and file handling for what Overhear keeps on this computer under OVERHEAR_HOME: the pasted Retell key
// (src/pull/key-store.ts) and pinned calls. One set of rules for both.
// - A folder must be a real directory (not a symlink), owned by this user, and closed to everyone else (0700).
//   Overhear creates a missing folder 0700. It never changes the mode of a folder it did not create: it refuses
//   with a clear message instead, so `OVERHEAR_HOME=$HOME` cannot chmod a home directory.
// - A file is 0600. A write goes to a fresh temp file that is then renamed into place, so a crash never leaves
//   half a file, and a symlink planted at the file's place is replaced rather than written through.
// - A read opens the file without following a symlink, and refuses one that is not a plain 0600 file owned by this
//   user, or that is bigger than the caller's cap.
//
// Errors carry a fixed message or a file system error, which names a path and never the file's contents.
import { randomBytes } from "node:crypto";
import { constants, promises as fs, type Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";

export type PrivateStoreErrorCode = "dir_unsafe" | "file_unsafe" | "file_too_large";

/** A folder or file Overhear could not trust, or a file over the cap. The message says what to do. */
export class PrivateStoreError extends Error {
  constructor(
    readonly code: PrivateStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrivateStoreError";
  }
}

const errno = (err: unknown) => (err as NodeJS.ErrnoException).code;

/** True when `stat` belongs to another user. Where there are no uids (Windows), nothing is another user's. */
function ownedByOther(stat: Stats): boolean {
  const uid = process.getuid?.();
  return uid !== undefined && stat.uid !== uid;
}

/** Throws unless `dir` is a real directory, owned by this user, that no one else can open. Changes nothing. */
export async function checkPrivateDir(dir: string): Promise<void> {
  const stat = await fs.lstat(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new PrivateStoreError("dir_unsafe", `${dir} is not a directory. Set OVERHEAR_HOME to a directory of its own.`);
  }
  if (ownedByOther(stat)) {
    throw new PrivateStoreError("dir_unsafe", `${dir} is not yours (owned by uid ${stat.uid}). Set OVERHEAR_HOME to a directory you own.`);
  }
  if ((stat.mode & 0o077) !== 0) {
    const mode = (stat.mode & 0o777).toString(8);
    throw new PrivateStoreError("dir_unsafe", `${dir} is open to other users (mode ${mode}). Run chmod 700 on it, or set OVERHEAR_HOME to a new directory.`);
  }
}

/** Creates the folder 0700 when it is missing, then checks it. Never changes a folder it did not create. */
export async function ensurePrivateDir(dir: string): Promise<void> {
  const created = await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (created !== undefined) await fs.chmod(dir, 0o700);
  await checkPrivateDir(dir);
}

/** Matches the temp files `writePrivateFile` makes for `name`: `.<name>.<16 hex>.tmp`. */
export function tempNamePattern(name: string): RegExp {
  const literal = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\.${literal}\\.[0-9a-f]{16}\\.tmp$`);
}

/** Deletes the files in `dir` whose names match `pattern` (temp files a crashed write left behind). Fine when `dir` is missing. */
export async function removeTemps(dir: string, pattern: RegExp): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (errno(err) === "ENOENT" || errno(err) === "ENOTDIR") return;
    throw err;
  }
  await Promise.all(names.filter((n) => pattern.test(n)).map((n) => fs.rm(path.join(dir, n), { force: true })));
}

/**
 * Writes `text` to `dir/name`, mode 0600, through a fresh temp file renamed into place. The caller makes sure `dir` is
 * private first (ensurePrivateDir) and clears old temps (removeTemps with tempNamePattern(name)).
 */
export async function writePrivateFile(dir: string, name: string, text: string): Promise<void> {
  const target = path.join(dir, name);
  const temp = path.join(dir, `.${name}.${randomBytes(8).toString("hex")}.tmp`);
  // "wx" fails if the temp name exists, so this never writes through a planted file or symlink.
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(text, "utf8");
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

export type ReadPrivateFileOptions = {
  /** What to do about a refused file, added after the message ("Disconnect and paste the key again."). */
  hint: string;
  /** Refuse a file bigger than this many bytes, before it is parsed. No cap when left out. */
  maxBytes?: number;
};

/**
 * The file's text, or null when there is no file. Throws PrivateStoreError when the file or its folder cannot be
 * trusted: a symlink, not a plain file, not this user's, not mode 0600, or over `maxBytes`.
 */
export async function readPrivateFile(file: string, options: ReadPrivateFileOptions): Promise<string | null> {
  let handle: FileHandle;
  try {
    // O_NOFOLLOW: a symlink at the file's place fails here (ELOOP) instead of being read through.
    // O_NONBLOCK: opening a pipe someone planted there does not hang; it is refused as not a plain file below.
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (err) {
    if (errno(err) === "ENOENT" || errno(err) === "ENOTDIR") return null;
    if (errno(err) === "ELOOP") throw new PrivateStoreError("file_unsafe", `${file} is a symlink. ${options.hint}`);
    throw err;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || ownedByOther(stat) || (stat.mode & 0o777) !== 0o600) {
      throw new PrivateStoreError("file_unsafe", `${file} is not a 0600 file of yours. ${options.hint}`);
    }
    await checkPrivateDir(path.dirname(file));
    const cap = options.maxBytes;
    if (cap === undefined) return await handle.readFile("utf8");
    if (stat.size > cap) throw new PrivateStoreError("file_too_large", `${file} is bigger than ${cap} bytes. ${options.hint}`);
    // Read one byte past the cap so a file that grew after the stat is still refused.
    const buffer = Buffer.alloc(cap + 1);
    const { bytesRead } = await handle.read(buffer, 0, cap + 1, 0);
    if (bytesRead > cap) throw new PrivateStoreError("file_too_large", `${file} is bigger than ${cap} bytes. ${options.hint}`);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}
