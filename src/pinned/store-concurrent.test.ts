// @vitest-environment node
// Two pins saved at the same time must not both pass the 500 cap check: the check and the write run one at a time.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PINS, PinStoreError, pinnedDir, savePin } from "./store";
import { failedPin } from "./testing";

let root: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "overhear-pin-race-")));
  vi.stubEnv("OVERHEAR_HOME", path.join(root, "home"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("savePin under concurrency", () => {
  it("never goes past the cap when several pins arrive at once", async () => {
    fs.mkdirSync(pinnedDir(), { recursive: true, mode: 0o700 });
    for (let i = 0; i < MAX_PINS - 1; i++) fs.writeFileSync(path.join(pinnedDir(), `pin-filler-${i}.json`), "{}", { mode: 0o600 });
    const results = await Promise.allSettled(["call_a", "call_b", "call_c", "call_d"].map((id) => savePin(failedPin(id))));
    const saved = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(saved).toHaveLength(1);
    expect(refused).toHaveLength(3);
    for (const r of refused) expect(r.reason).toBeInstanceOf(PinStoreError);
    expect(fs.readdirSync(pinnedDir()).filter((n) => /^pin-.+\.json$/.test(n))).toHaveLength(MAX_PINS);
  });

  it("keeps going after one save fails", async () => {
    const bad = failedPin("call_a");
    bad.pin = undefined;
    await expect(savePin(bad)).rejects.toBeInstanceOf(PinStoreError);
    await expect(savePin(failedPin("call_b"))).resolves.toMatchObject({ id: expect.stringMatching(/^pin-call-b-/) });
  });
});
