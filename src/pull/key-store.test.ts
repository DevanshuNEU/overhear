// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configPath, hasKey, overhearHome, readKey, removeKey, writeKey } from "./key-store";

const KEY = "key_STORETEST0123456789abcdef";
let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-keystore-"));
  vi.stubEnv("OVERHEAR_HOME", path.join(home, "dot-overhear"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

const mode = (p: string) => fs.statSync(p).mode & 0o777;

describe("where the key lives", () => {
  it("is ~/.overhear/config.json by default, and OVERHEAR_HOME moves it", () => {
    expect(overhearHome({})).toBe(path.join(os.homedir(), ".overhear"));
    expect(overhearHome({ OVERHEAR_HOME: "/tmp/x" })).toBe("/tmp/x");
    expect(configPath()).toBe(path.join(home, "dot-overhear", "config.json"));
  });

  it("ignores an empty or relative OVERHEAR_HOME", () => {
    expect(overhearHome({ OVERHEAR_HOME: "" })).toBe(path.join(os.homedir(), ".overhear"));
    expect(overhearHome({ OVERHEAR_HOME: "relative/dir" })).toBe(path.join(os.homedir(), ".overhear"));
  });
});

describe("key store", () => {
  it("readKey returns null when there is no file", async () => {
    expect(await readKey()).toBeNull();
    expect(await hasKey()).toBe(false);
  });

  it("writes the file with mode 0600 in a 0700 directory under OVERHEAR_HOME", async () => {
    await writeKey(KEY);
    expect(mode(path.join(home, "dot-overhear"))).toBe(0o700);
    expect(mode(configPath())).toBe(0o600);
    expect(await readKey()).toBe(KEY);
    expect(await hasKey()).toBe(true);
  });

  it("tightens a directory that already exists with looser permissions", async () => {
    fs.mkdirSync(path.join(home, "dot-overhear"), { mode: 0o755 });
    fs.chmodSync(path.join(home, "dot-overhear"), 0o755);
    await writeKey(KEY);
    expect(mode(path.join(home, "dot-overhear"))).toBe(0o700);
  });

  it("replaces an existing key atomically and leaves no temp files behind", async () => {
    await writeKey(KEY);
    await writeKey("key_SECONDKEY0123456789abcdef");
    expect(await readKey()).toBe("key_SECONDKEY0123456789abcdef");
    expect(fs.readdirSync(path.join(home, "dot-overhear"))).toEqual(["config.json"]);
    expect(mode(configPath())).toBe(0o600);
  });

  it("replaces a symlink at the file's place instead of writing through it", async () => {
    fs.mkdirSync(path.join(home, "dot-overhear"), { mode: 0o700 });
    const target = path.join(home, "elsewhere.txt");
    fs.writeFileSync(target, "untouched");
    fs.symlinkSync(target, configPath());
    await writeKey(KEY);
    expect(fs.readFileSync(target, "utf8")).toBe("untouched");
    expect(fs.lstatSync(configPath()).isSymbolicLink()).toBe(false);
    expect(await readKey()).toBe(KEY);
  });

  it("refuses to use a home directory that is a symlink", async () => {
    const real = path.join(home, "real");
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, path.join(home, "dot-overhear"));
    await expect(writeKey(KEY)).rejects.toThrow();
    expect(fs.readdirSync(real)).toEqual([]);
  });

  it("removeKey deletes the file, and is fine when there is none", async () => {
    await writeKey(KEY);
    await removeKey();
    expect(fs.existsSync(configPath())).toBe(false);
    expect(await readKey()).toBeNull();
    await expect(removeKey()).resolves.toBeUndefined();
  });

  it("reads a damaged or foreign file as no key", async () => {
    fs.mkdirSync(path.join(home, "dot-overhear"), { mode: 0o700 });
    for (const content of ["", "not json", "[]", "null", '{"retellApiKey": 5}', '{"retellApiKey": ""}', '{"other": "x"}']) {
      fs.writeFileSync(configPath(), content, { mode: 0o600 });
      expect(await readKey(), content).toBeNull();
    }
  });

  it("refuses to store an empty key or one with control characters or spaces", async () => {
    for (const bad of ["", " ", "key with space", "key\nnewline", "key\u0000nul", "x".repeat(300)]) {
      await expect(writeKey(bad), JSON.stringify(bad)).rejects.toThrow();
    }
    expect(fs.existsSync(configPath())).toBe(false);
  });
});
