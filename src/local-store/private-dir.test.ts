// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPrivateDir, ensurePrivateDir, PrivateStoreError, readPrivateFile, removeTemps, tempNamePattern, writePrivateFile } from "./private-dir";

let root: string;
let dir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-private-dir-"));
  vi.stubEnv("OVERHEAR_HOME", root);
  dir = path.join(process.env.OVERHEAR_HOME ?? "", "pinned");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

const mode = (p: string) => fs.statSync(p).mode & 0o777;
const refusal = async (run: () => Promise<unknown>) => (await run().catch((e: unknown) => e)) as PrivateStoreError;

describe("ensurePrivateDir", () => {
  it("creates a missing folder, parents included, 0700", async () => {
    const deep = path.join(dir, "deeper");
    await ensurePrivateDir(deep);
    expect(mode(deep)).toBe(0o700);
  });

  it("uses an existing 0700 folder it owns", async () => {
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    await expect(ensurePrivateDir(dir)).resolves.toBeUndefined();
  });

  it("refuses a symlinked folder and writes nothing through it", async () => {
    const real = path.join(root, "real");
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, dir);
    const err = await refusal(() => ensurePrivateDir(dir));
    expect(err).toBeInstanceOf(PrivateStoreError);
    expect(err.code).toBe("dir_unsafe");
    expect(err.message).toBe(`${dir} is not a directory. Set OVERHEAR_HOME to a directory of its own.`);
    expect(fs.readdirSync(real)).toEqual([]);
  });

  it("refuses a symlinked folder given with a trailing slash or dot, which would otherwise be followed", async () => {
    const real = path.join(root, "real");
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, dir);
    for (const spelled of [`${dir}/`, `${dir}//`, `${dir}/.`]) {
      const err = await refusal(() => ensurePrivateDir(spelled));
      expect(err, spelled).toBeInstanceOf(PrivateStoreError);
      expect(err.code).toBe("dir_unsafe");
      expect(err.message).toBe(`${dir} is not a directory. Set OVERHEAR_HOME to a directory of its own.`);
      expect((await refusal(() => checkPrivateDir(spelled))).code).toBe("dir_unsafe");
      await expect(writePrivateFile(spelled, "pin-a.json", "x"), spelled).rejects.toBeInstanceOf(PrivateStoreError);
    }
    expect(fs.readdirSync(real)).toEqual([]);
  });

  it("refuses a group or world readable folder and never changes its mode", async () => {
    for (const loose of [0o755, 0o750, 0o711, 0o701, 0o705]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.chmodSync(dir, loose);
      const err = await refusal(() => ensurePrivateDir(dir));
      expect(err, loose.toString(8)).toBeInstanceOf(PrivateStoreError);
      expect(err.code).toBe("dir_unsafe");
      expect(err.message).toBe(`${dir} is open to other users (mode ${loose.toString(8)}). Run chmod 700 on it, or set OVERHEAR_HOME to a new directory.`);
      expect(mode(dir), loose.toString(8)).toBe(loose);
    }
  });

  it("refuses a path that is a file, and leaves the file alone", async () => {
    fs.writeFileSync(dir, "x", { mode: 0o600 });
    await expect(ensurePrivateDir(dir)).rejects.toThrow();
    expect(fs.readFileSync(dir, "utf8")).toBe("x");
  });

  it.skipIf(process.getuid?.() === 0 || process.getuid === undefined)("refuses a folder owned by another user", async () => {
    const err = await refusal(() => ensurePrivateDir("/usr"));
    expect(err.code).toBe("dir_unsafe");
    expect(err.message).toMatch(/is not yours \(owned by uid \d+\)\. Set OVERHEAR_HOME to a directory you own\.$/);
  });
});

describe("checkPrivateDir", () => {
  it("passes a 0700 folder and refuses a loose one without touching it", async () => {
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    await expect(checkPrivateDir(dir)).resolves.toBeUndefined();
    fs.chmodSync(dir, 0o750);
    expect((await refusal(() => checkPrivateDir(dir))).code).toBe("dir_unsafe");
    expect(mode(dir)).toBe(0o750);
  });

  it("throws the file system error when the folder is missing", async () => {
    const err = (await checkPrivateDir(dir).catch((e: unknown) => e)) as NodeJS.ErrnoException;
    expect(err.code).toBe("ENOENT");
  });
});

describe("writePrivateFile and readPrivateFile", () => {
  const HINT = "Delete it and pin again.";

  it("writes 0600 and reads back, leaving no temp file", async () => {
    await ensurePrivateDir(dir);
    await writePrivateFile(dir, "pin-a.json", '{"a":1}\n');
    expect(mode(path.join(dir, "pin-a.json"))).toBe(0o600);
    expect(fs.readdirSync(dir)).toEqual(["pin-a.json"]);
    expect(await readPrivateFile(path.join(dir, "pin-a.json"), { hint: HINT })).toBe('{"a":1}\n');
  });

  it("replaces an existing file atomically", async () => {
    await ensurePrivateDir(dir);
    await writePrivateFile(dir, "pin-a.json", "one");
    await writePrivateFile(dir, "pin-a.json", "two");
    expect(await readPrivateFile(path.join(dir, "pin-a.json"), { hint: HINT })).toBe("two");
    expect(fs.readdirSync(dir)).toEqual(["pin-a.json"]);
  });

  it("replaces a planted symlink at the target name instead of following it", async () => {
    await ensurePrivateDir(dir);
    const elsewhere = path.join(root, "elsewhere.txt");
    fs.writeFileSync(elsewhere, "untouched");
    fs.symlinkSync(elsewhere, path.join(dir, "pin-a.json"));
    await writePrivateFile(dir, "pin-a.json", "mine");
    expect(fs.readFileSync(elsewhere, "utf8")).toBe("untouched");
    expect(fs.lstatSync(path.join(dir, "pin-a.json")).isSymbolicLink()).toBe(false);
    expect(await readPrivateFile(path.join(dir, "pin-a.json"), { hint: HINT })).toBe("mine");
  });

  it("cleans its temp file when the rename fails", async () => {
    await ensurePrivateDir(dir);
    // A folder at the target name makes the rename fail.
    fs.mkdirSync(path.join(dir, "pin-a.json"), { mode: 0o700 });
    await expect(writePrivateFile(dir, "pin-a.json", "x")).rejects.toThrow();
    expect(fs.readdirSync(dir)).toEqual(["pin-a.json"]);
  });

  it("refuses a file name that is not a plain name, and writes nothing", async () => {
    await ensurePrivateDir(dir);
    for (const bad of ["", ".", "..", "../escape.json", "sub/pin-a.json", "/abs.json", "a/../b.json"]) {
      await expect(writePrivateFile(dir, bad, "x"), JSON.stringify(bad)).rejects.toThrow(/not a plain file name/);
    }
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(fs.readdirSync(root)).toEqual(["pinned"]);
  });

  it("opens the folder read-only to sync it after the rename", async () => {
    await ensurePrivateDir(dir);
    const open = vi.spyOn(fs.promises, "open");
    await writePrivateFile(dir, "pin-a.json", "x");
    const opened = open.mock.calls.map(([p, flags]) => `${String(p)}|${String(flags)}`);
    open.mockRestore();
    expect(opened).toContain(`${dir}|r`);
    expect(mode(path.join(dir, "pin-a.json"))).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("refuses a pipe at the file's place without hanging", async () => {
    await ensurePrivateDir(dir);
    const fifo = path.join(dir, "pin-a.json");
    try {
      execFileSync("mkfifo", ["-m", "600", fifo]);
    } catch {
      return; // no mkfifo here
    }
    const err = await refusal(() => readPrivateFile(fifo, { hint: HINT }));
    expect(err).toBeInstanceOf(PrivateStoreError);
    expect(err.code).toBe("file_unsafe");
  });

  it("returns null when the file is missing", async () => {
    await ensurePrivateDir(dir);
    expect(await readPrivateFile(path.join(dir, "pin-none.json"), { hint: HINT })).toBeNull();
    expect(await readPrivateFile(path.join(dir, "no-folder", "pin-none.json"), { hint: HINT })).toBeNull();
  });

  it("refuses a file that is a symlink", async () => {
    await ensurePrivateDir(dir);
    const elsewhere = path.join(root, "elsewhere.json");
    fs.writeFileSync(elsewhere, "{}", { mode: 0o600 });
    fs.symlinkSync(elsewhere, path.join(dir, "pin-a.json"));
    const err = await refusal(() => readPrivateFile(path.join(dir, "pin-a.json"), { hint: HINT }));
    expect(err).toBeInstanceOf(PrivateStoreError);
    expect(err.code).toBe("file_unsafe");
    expect(err.message).toBe(`${path.join(dir, "pin-a.json")} is a symlink. ${HINT}`);
  });

  it("refuses a file whose mode is not 0600", async () => {
    await ensurePrivateDir(dir);
    const file = path.join(dir, "pin-a.json");
    await writePrivateFile(dir, "pin-a.json", "{}");
    for (const loose of [0o644, 0o640, 0o604, 0o400, 0o700]) {
      fs.chmodSync(file, loose);
      const err = await refusal(() => readPrivateFile(file, { hint: HINT }));
      expect(err, loose.toString(8)).toBeInstanceOf(PrivateStoreError);
      expect(err.code).toBe("file_unsafe");
      expect(err.message).toBe(`${file} is not a 0600 file of yours. ${HINT}`);
    }
    fs.chmodSync(file, 0o600);
    expect(await readPrivateFile(file, { hint: HINT })).toBe("{}");
  });

  it("refuses a non-regular file", async () => {
    await ensurePrivateDir(dir);
    const sub = path.join(dir, "pin-a.json");
    fs.mkdirSync(sub, { mode: 0o700 });
    fs.chmodSync(sub, 0o600);
    const err = await refusal(() => readPrivateFile(sub, { hint: HINT }));
    expect(err).toBeInstanceOf(PrivateStoreError);
    expect(err.code).toBe("file_unsafe");
  });

  it("refuses to read from a folder other users can open", async () => {
    await ensurePrivateDir(dir);
    await writePrivateFile(dir, "pin-a.json", "{}");
    fs.chmodSync(dir, 0o755);
    const err = await refusal(() => readPrivateFile(path.join(dir, "pin-a.json"), { hint: HINT }));
    expect(err.code).toBe("dir_unsafe");
  });

  it("enforces maxBytes: exactly the cap reads, one more byte is refused", async () => {
    await ensurePrivateDir(dir);
    const file = path.join(dir, "pin-a.json");
    await writePrivateFile(dir, "pin-a.json", "x".repeat(10));
    expect(await readPrivateFile(file, { hint: HINT, maxBytes: 10 })).toBe("x".repeat(10));
    await writePrivateFile(dir, "pin-a.json", "x".repeat(11));
    const err = await refusal(() => readPrivateFile(file, { hint: HINT, maxBytes: 10 }));
    expect(err).toBeInstanceOf(PrivateStoreError);
    expect(err.code).toBe("file_too_large");
  });
});

describe("removeTemps", () => {
  it("deletes only files that match the pattern, and is fine on a missing folder", async () => {
    await ensurePrivateDir(dir);
    const pattern = tempNamePattern("pin-a.json");
    const temps = [".pin-a.json.0123456789abcdef.tmp", ".pin-a.json.fedcba9876543210.tmp"];
    for (const name of temps) fs.writeFileSync(path.join(dir, name), "secret", { mode: 0o600 });
    fs.writeFileSync(path.join(dir, "pin-a.json"), "keep", { mode: 0o600 });
    fs.writeFileSync(path.join(dir, ".pin-b.json.0123456789abcdef.tmp"), "other file's temp", { mode: 0o600 });
    await removeTemps(dir, pattern);
    expect(fs.readdirSync(dir).sort()).toEqual([".pin-b.json.0123456789abcdef.tmp", "pin-a.json"]);
    await expect(removeTemps(path.join(root, "missing"), pattern)).resolves.toBeUndefined();
  });

  it("tempNamePattern matches what writePrivateFile makes, and treats the name literally", () => {
    const pattern = tempNamePattern("a.b.json");
    expect(pattern.test(".a.b.json.0123456789abcdef.tmp")).toBe(true);
    expect(pattern.test(".aXb.json.0123456789abcdef.tmp")).toBe(false);
  });
});
