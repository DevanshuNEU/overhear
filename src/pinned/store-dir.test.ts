// @vitest-environment node
// listPins with a folder given and the mode checks off: the exported folder `npm run check:pinned --dir` reads.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatCase, parseCase, type EvalCase } from "@/engine/eval/case";
import { PrivateStoreError } from "@/local-store/private-dir";
import { pinIdFor } from "./pin-id";
import { listPins, MAX_PIN_BYTES, PinStoreError } from "./store";

let root: string;
let given: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "overhear-pin-dir-")));
  given = path.join(root, "exported");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function pinFor(callId = "call_8f2a9c"): EvalCase {
  return parseCase({
    schemaVersion: 1,
    id: pinIdFor(callId),
    source: "real",
    independent: false,
    platform: "retell",
    locked: true,
    label: { by: "you", at: "2026-11-08T10:15:00-05:00" },
    tz: "America/New_York",
    pin: { callId, agentId: "agent_1", agentVersion: "3", pinnedWith: "0.1.0" },
    expect: { verdict: "failed" },
    record: { call_id: callId, agent_id: "agent_1", transcript_with_tool_calls: [{ role: "agent", content: "hello" }] },
  });
}

/** A file the way a checkout writes it: 0644, in a 0755 folder. */
function plant(name: string, text: string, mode = 0o644): void {
  fs.mkdirSync(given, { recursive: true, mode: 0o755 });
  fs.chmodSync(given, 0o755);
  fs.writeFileSync(path.join(given, name), text, { mode });
  fs.chmodSync(path.join(given, name), mode);
}

const failure = async (run: () => Promise<unknown>) => (await run().catch((e: unknown) => e)) as Error;

describe("listPins({ dir, private: false })", () => {
  it("reads 0644 files in a 0755 folder inside a repo checkout, and never touches OVERHEAR_HOME", async () => {
    fs.mkdirSync(path.join(root, ".git"));
    const pin = pinFor();
    plant(`${pin.id}.json`, formatCase(pin));
    expect(await listPins({ dir: given, private: false })).toEqual({ pins: [{ id: pin.id, pin }], problems: [] });
  });

  it("still refuses a 0644 file and a 0755 folder when the mode checks are on", async () => {
    const pin = pinFor();
    plant(`${pin.id}.json`, formatCase(pin));
    expect(await failure(() => listPins({ dir: given }))).toBeInstanceOf(PrivateStoreError);
    fs.chmodSync(given, 0o700);
    const { pins, problems } = await listPins({ dir: given });
    expect(pins).toEqual([]);
    expect(problems[0].message).toContain("is not a 0600 file of yours");
  });

  it("still refuses a symlinked folder, and says a missing folder is missing", async () => {
    fs.mkdirSync(path.join(root, "real"));
    fs.symlinkSync(path.join(root, "real"), given);
    expect(await failure(() => listPins({ dir: given, private: false }))).toBeInstanceOf(PrivateStoreError);
    fs.rmSync(given);
    const err = await failure(() => listPins({ dir: given, private: false }));
    expect(err).toBeInstanceOf(PinStoreError);
    expect((err as PinStoreError).code).toBe("not_found");
  });

  it("still reports a symlink, a folder, a file over 5 MB and a failed read-back as problems, reading none", async () => {
    const pin = pinFor();
    plant(`${pin.id}.json`, formatCase(pin));
    fs.symlinkSync(path.join(given, `${pin.id}.json`), path.join(given, "pin-link-1.json"));
    fs.mkdirSync(path.join(given, "pin-folder-1.json"));
    plant("pin-big-1.json", "x".repeat(MAX_PIN_BYTES + 1));
    plant("pin-renamed-1.json", formatCase(pin));
    const { pins, problems } = await listPins({ dir: given, private: false });
    expect(pins.map((p) => p.id)).toEqual([pin.id]);
    expect(problems.map((p) => p.file).sort()).toEqual(["pin-big-1.json", "pin-folder-1.json", "pin-link-1.json", "pin-renamed-1.json"]);
  });
});
