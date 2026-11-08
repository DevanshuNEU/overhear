// @vitest-environment node
// removeKey checks the home folder before it deletes anything, so a symlinked OVERHEAR_HOME cannot point the delete at
// another folder. (key-store.test.ts covers the ordinary disconnect.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyStoreError, removeKey, writeKey } from "./key-store";

let root: string;
let home: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-keystore-remove-"));
  home = path.join(root, "dot-overhear");
  vi.stubEnv("OVERHEAR_HOME", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("removeKey and the home folder", () => {
  it("refuses a symlinked home, deletes nothing in the target, and says home_unsafe", async () => {
    const target = path.join(root, "target");
    fs.mkdirSync(target, { mode: 0o700 });
    fs.writeFileSync(path.join(target, "config.json"), "keep", { mode: 0o600 });
    fs.writeFileSync(path.join(target, ".config.json.0123456789abcdef.tmp"), "keep", { mode: 0o600 });
    fs.symlinkSync(target, home);
    const err = await removeKey().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyStoreError);
    expect((err as KeyStoreError).code).toBe("home_unsafe");
    expect((err as Error).message).toBe(`${home} is not a directory. Set OVERHEAR_HOME to a directory of its own.`);
    expect(fs.readdirSync(target).sort()).toEqual([".config.json.0123456789abcdef.tmp", "config.json"]);
  });

  it("deletes the key and temps from a home folder whose mode has loosened, and leaves its mode alone", async () => {
    await writeKey("key_REMOVETEST0123456789abcdef");
    fs.writeFileSync(path.join(home, ".config.json.0123456789abcdef.tmp"), "x", { mode: 0o600 });
    fs.writeFileSync(path.join(home, "notes.txt"), "keep");
    for (const loose of [0o755, 0o750, 0o701]) {
      fs.chmodSync(home, loose);
      fs.writeFileSync(path.join(home, "config.json"), "{}", { mode: 0o600 });
      await removeKey();
      expect(fs.readdirSync(home).sort(), loose.toString(8)).toEqual(["notes.txt"]);
      expect(fs.statSync(home).mode & 0o777).toBe(loose);
    }
  });

  it("refuses a path that is a regular file instead of a home folder", async () => {
    fs.writeFileSync(home, "x");
    const err = await removeKey().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyStoreError);
    expect((err as KeyStoreError).code).toBe("home_unsafe");
    expect(fs.readFileSync(home, "utf8")).toBe("x");
  });

  it("is fine when the home folder does not exist", async () => {
    await expect(removeKey()).resolves.toBeUndefined();
    expect(fs.existsSync(home)).toBe(false);
  });

  it("still deletes the key and a fresh leftover temp in a real home", async () => {
    await writeKey("key_REMOVETEST0123456789abcdef");
    fs.writeFileSync(path.join(home, ".config.json.0123456789abcdef.tmp"), "x", { mode: 0o600 });
    await removeKey();
    expect(fs.readdirSync(home)).toEqual([]);
  });
});
