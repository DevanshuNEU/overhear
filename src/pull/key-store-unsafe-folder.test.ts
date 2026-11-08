// @vitest-environment node
// The folder becomes unsafe between writeKey's ensure step and the write itself. The write's own folder check must
// surface as the key store's error (home_unsafe, same message), not as a generic failure.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/local-store/private-dir", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/local-store/private-dir")>();
  return {
    ...real,
    // Ensure passes, then someone opens the folder up before the write.
    ensurePrivateDir: async (folder: string) => {
      await real.ensurePrivateDir(folder);
      fs.chmodSync(folder, 0o755);
    },
  };
});

import { configPath, KeyStoreError, writeKey } from "./key-store";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-keystore-race-"));
  vi.stubEnv("OVERHEAR_HOME", path.join(home, "dot-overhear"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("writeKey when the folder turns unsafe after the ensure step", () => {
  it("throws a KeyStoreError with code home_unsafe and the usual message, and writes nothing", async () => {
    const dir = path.join(home, "dot-overhear");
    const err = await writeKey("key_RACETEST0123456789abcdef").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KeyStoreError);
    expect((err as KeyStoreError).code).toBe("home_unsafe");
    expect((err as Error).message).toBe(`${dir} is open to other users (mode 755). Run chmod 700 on it, or set OVERHEAR_HOME to a new directory.`);
    expect(fs.existsSync(configPath())).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});
