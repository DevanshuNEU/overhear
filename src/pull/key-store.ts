// The pasted Retell key, kept on this computer in `~/.overhear/config.json` (OVERHEAR_HOME moves the directory;
// the tests use it so they never touch the real one). The directory is 0700 and the file 0600. A write goes to a
// fresh temp file that is then renamed into place, so a crash never leaves half a key, and a symlink planted at
// the file's place is replaced rather than written through.
//
// The key leaves this module only through readKey, and only src/pull/retell-source.ts calls it (a test checks).
// Nothing here puts the key in an error: every error this module throws carries a fixed message or a file
// system error, which names a path and never the file's contents.
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_FILE = "config.json";

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

async function ensureHome(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory()) throw new Error("The Overhear home is not a directory.");
  if ((stat.mode & 0o777) !== 0o700) await fs.chmod(dir, 0o700);
}

export async function writeKey(key: string): Promise<void> {
  if (typeof key !== "string" || !isKeyShaped(key)) throw new Error("That is not a Retell API key.");
  const dir = overhearHome();
  await ensureHome(dir);
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

/** The stored key, or null when there is none or the file is not one Overhear wrote. */
export async function readKey(): Promise<string | null> {
  let text: string;
  try {
    text = await fs.readFile(configPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR") return null;
    throw err;
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

/** Deletes the key file. Fine when there is none. */
export async function removeKey(): Promise<void> {
  await fs.rm(configPath(), { force: true });
}
