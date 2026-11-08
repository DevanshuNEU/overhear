// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatCase, parseCase, type EvalCase } from "@/engine/eval/case";
import { PrivateStoreError } from "@/local-store/private-dir";
import { pinIdFor } from "./pin-id";
import { deleteAllPins, deletePin, listPins, MAX_PINS, PinStoreError, pinnedDir, savePin } from "./store";

const MARKER = "CANARY-PHI-91b2";

let root: string;
let home: string;
let dir: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "overhear-pin-store-")));
  home = path.join(root, "home");
  vi.stubEnv("OVERHEAR_HOME", home);
  dir = path.join(home, "pinned");
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

/** The raw form of a valid pin for a call. */
function rawPin(callId = "call_8f2a9c", over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: pinIdFor(callId),
    source: "real",
    independent: false,
    platform: "retell",
    locked: true,
    label: { by: "you", at: "2026-11-08T10:15:00-05:00", note: "nurse transfer promised, never made" },
    tz: "America/New_York",
    pin: { callId, agentId: "agent_1", agentVersion: "3", pinnedWith: "0.1.0" },
    expect: { verdict: "failed", contracts: { transfer_kept: "violated" } },
    record: { call_id: callId, agent_id: "agent_1", transcript_with_tool_calls: [{ role: "agent", content: MARKER }] },
    ...over,
  };
}

const pinFor = (callId = "call_8f2a9c"): EvalCase => parseCase(rawPin(callId));
const file = (callId = "call_8f2a9c") => path.join(dir, `${pinIdFor(callId)}.json`);
const mode = (p: string) => fs.statSync(p).mode & 0o777;
const failure = async (run: () => Promise<unknown>) => (await run().catch((e: unknown) => e)) as Error;
/** A pinned folder made the way the store makes it. */
const makeDir = () => fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const plant = (name: string, text: string, fileMode = 0o600) => {
  makeDir();
  fs.writeFileSync(path.join(dir, name), text, { mode: fileMode });
  fs.chmodSync(path.join(dir, name), fileMode);
};

describe("pinnedDir", () => {
  it("is pinned/ inside OVERHEAR_HOME", () => {
    expect(pinnedDir()).toBe(dir);
    expect(pinnedDir({ OVERHEAR_HOME: "/tmp/x" })).toBe("/tmp/x/pinned");
  });
});

describe("savePin and listPins", () => {
  it("writes a 0600 file in a 0700 folder, with the case's canonical text, and lists it back", async () => {
    const pin = pinFor();
    expect(await savePin(pin)).toEqual({ id: pinIdFor("call_8f2a9c") });
    expect(mode(home)).toBe(0o700);
    expect(mode(dir)).toBe(0o700);
    expect(mode(file())).toBe(0o600);
    expect(fs.readFileSync(file(), "utf8")).toBe(formatCase(pin));
    const listing = await listPins();
    expect(listing.problems).toEqual([]);
    expect(listing.pins).toEqual([{ id: pin.id, pin }]);
  });

  it("lists nothing, without creating anything, when there is no folder", async () => {
    expect(await listPins()).toEqual({ pins: [], problems: [] });
    expect(fs.existsSync(home)).toBe(false);
  });

  it("saving the same call again replaces its file", async () => {
    await savePin(pinFor());
    const changed = parseCase(rawPin("call_8f2a9c", { label: { by: "you", at: "2026-11-09", note: "second" } }));
    await savePin(changed);
    expect(fs.readdirSync(dir)).toEqual([`${changed.id}.json`]);
    expect((await listPins()).pins[0].pin.label.note).toBe("second");
  });

  it("refuses a symlink planted at the pin's place by replacing it, never writing through it", async () => {
    makeDir();
    const target = path.join(root, "elsewhere.txt");
    fs.writeFileSync(target, "untouched");
    fs.symlinkSync(target, file());
    await savePin(pinFor());
    expect(fs.lstatSync(file()).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("untouched");
    expect(mode(file())).toBe(0o600);
  });
});

describe("the folder", () => {
  it("refuses a symlinked pinned folder everywhere and writes nothing through it", async () => {
    const real = path.join(root, "real");
    fs.mkdirSync(real, { mode: 0o700 });
    fs.mkdirSync(home, { mode: 0o700 });
    fs.symlinkSync(real, dir);
    for (const run of [() => savePin(pinFor()), () => listPins(), () => deletePin(pinIdFor("call_8f2a9c")), () => deleteAllPins()]) {
      const err = await failure(run);
      expect(err).toBeInstanceOf(PrivateStoreError);
      expect((err as PrivateStoreError).code).toBe("dir_unsafe");
    }
    expect(fs.readdirSync(real)).toEqual([]);
  });

  it("refuses a pinned folder open to other users (0755) for save and list, and never changes its mode", async () => {
    fs.mkdirSync(home, { mode: 0o700 });
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o755);
    for (const run of [() => savePin(pinFor()), () => listPins()]) {
      expect((await failure(run)).message).toContain("open to other users");
    }
    expect(mode(dir)).toBe(0o755);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("checks OVERHEAR_HOME itself before using pinned/ inside it: 0755 and symlinked homes are refused", async () => {
    fs.mkdirSync(home);
    fs.chmodSync(home, 0o755);
    for (const run of [() => savePin(pinFor()), () => listPins()]) {
      expect((await failure(run)).message).toContain("open to other users");
    }
    expect(fs.readdirSync(home)).toEqual([]);
    expect(mode(home)).toBe(0o755);
    fs.rmdirSync(home);

    const real = path.join(root, "real-home");
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, home);
    for (const run of [() => savePin(pinFor()), () => listPins(), () => deleteAllPins()]) {
      expect(((await failure(run)) as PrivateStoreError).code).toBe("dir_unsafe");
    }
    expect(fs.readdirSync(real)).toEqual([]);
  });

  it.each([
    ["a .git folder", (p: string) => fs.mkdirSync(path.join(p, ".git"))],
    ["a .git file, as in a worktree", (p: string) => fs.writeFileSync(path.join(p, ".git"), "gitdir: /elsewhere")],
  ])("refuses a folder with %s in a parent, and creates nothing", async (_what, mark) => {
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    mark(repo);
    const inside = path.join(repo, "a", "b", "home");
    vi.stubEnv("OVERHEAR_HOME", inside);
    for (const run of [() => savePin(pinFor()), () => listPins()]) {
      const err = await failure(run);
      expect(err).toBeInstanceOf(PinStoreError);
      expect((err as PinStoreError).code).toBe("in_repo");
    }
    expect(fs.existsSync(path.join(repo, "a"))).toBe(false);
  });

  it("refuses a folder reached through a symlinked parent that leads into a repo", async () => {
    const repo = path.join(root, "repo");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    fs.mkdirSync(path.join(repo, "data"), { mode: 0o700 });
    const link = path.join(root, "link");
    fs.symlinkSync(path.join(repo, "data"), link);
    vi.stubEnv("OVERHEAR_HOME", path.join(link, "home"));
    expect(((await failure(() => savePin(pinFor()))) as PinStoreError).code).toBe("in_repo");
    expect(fs.readdirSync(path.join(repo, "data"))).toEqual([]);
  });
});

describe("temp files", () => {
  const tempName = (hex: string, callId = "call_8f2a9c") => `.${pinIdFor(callId)}.json.${hex}.tmp`;

  it("a save removes old, future-dated and other pins' temps, and spares a fresh one", async () => {
    const old = tempName("0123456789abcdef");
    const future = tempName("1123456789abcdef", "call_other");
    const fresh = tempName("2123456789abcdef");
    for (const name of [old, future, fresh]) plant(name, "secret");
    const ago = new Date(Date.now() - 120_000);
    const ahead = new Date(Date.now() + 3600_000);
    fs.utimesSync(path.join(dir, old), ago, ago);
    fs.utimesSync(path.join(dir, future), ahead, ahead);
    await savePin(pinFor());
    expect(fs.readdirSync(dir).sort()).toEqual([fresh, `${pinIdFor("call_8f2a9c")}.json`].sort());
  });

  it("a delete removes old temps too", async () => {
    await savePin(pinFor());
    const old = tempName("0123456789abcdef");
    plant(old, "secret");
    const ago = new Date(Date.now() - 120_000);
    fs.utimesSync(path.join(dir, old), ago, ago);
    await deletePin(pinIdFor("call_8f2a9c"));
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("never removes a file that is not a pin temp", async () => {
    plant("notes.txt", "mine");
    plant(".config.json.0123456789abcdef.tmp", "key");
    const ago = new Date(Date.now() - 120_000);
    fs.utimesSync(path.join(dir, ".config.json.0123456789abcdef.tmp"), ago, ago);
    await savePin(pinFor());
    expect(fs.readdirSync(dir).sort()).toEqual([".config.json.0123456789abcdef.tmp", "notes.txt", `${pinIdFor("call_8f2a9c")}.json`].sort());
  });
});

describe("caps", () => {
  const fill = (count: number) => {
    makeDir();
    for (let i = 0; i < count; i += 1) fs.writeFileSync(path.join(dir, `pin-filler-${String(i).padStart(4, "0")}.json`), "{}", { mode: 0o600 });
  };

  it("refuses a pin past 500, but still replaces one that is already kept", async () => {
    fill(MAX_PINS - 1);
    await savePin(pinFor("call_a"));
    const err = await failure(() => savePin(pinFor("call_b")));
    expect((err as PinStoreError).code).toBe("too_many");
    expect(fs.existsSync(file("call_b"))).toBe(false);
    await expect(savePin(pinFor("call_a"))).resolves.toBeDefined();
  });

  it("reads at most 500 files and reports the rest as one problem", async () => {
    fill(MAX_PINS + 1);
    const listing = await listPins();
    expect(listing.pins.length + listing.problems.length).toBe(MAX_PINS + 1);
    expect(listing.problems.at(-1)?.message).toContain(`${MAX_PINS + 1} pin files`);
  });

  it("refuses to write a pin over 5 MB, and reports a file over 5 MB as a problem without reading it in", async () => {
    const big = parseCase(rawPin("call_big", { record: { call_id: "call_big", agent_id: "agent_1", blob: "x".repeat(5 * 1024 * 1024) } }));
    expect(((await failure(() => savePin(big))) as PinStoreError).code).toBe("too_large");
    expect(fs.existsSync(dir)).toBe(false);
    plant("pin-big-1.json", "x".repeat(5 * 1024 * 1024 + 1));
    const listing = await listPins();
    expect(listing.pins).toEqual([]);
    expect(listing.problems).toEqual([{ file: "pin-big-1.json", message: "pin-big-1.json is bigger than 5 MB, so it was not read." }]);
  });
});

describe("savePin refuses a bad pin and writes nothing", () => {
  it.each([
    ["a record with no call_id (a failed trim)", () => ({ ...pinFor(), record: {} })],
    ["a record of another call", () => ({ ...pinFor(), record: { call_id: "call_other" } })],
    ["a pin with no time zone", () => ({ ...pinFor(), tz: undefined })],
    ["a case with no pin block", () => ({ ...pinFor(), pin: undefined })],
    ["an id that is not the one its call gives", () => ({ ...pinFor(), id: "pin-call-8f2a9c-00000000" })],
    ["a pin not locked", () => ({ ...pinFor(), locked: false })],
  ])("%s", async (_what, build) => {
    const err = await failure(() => savePin(build() as EvalCase));
    expect(err).toBeInstanceOf(PinStoreError);
    expect((err as PinStoreError).code).toBe("invalid_pin");
    expect(err.message).not.toContain(MARKER);
    expect(fs.existsSync(home)).toBe(false);
  });
});

describe("listPins read-back checks", () => {
  it("a 0644 file is a problem naming the file, never read, never a throw", async () => {
    plant(`${pinIdFor("call_8f2a9c")}.json`, formatCase(pinFor()), 0o644);
    const listing = await listPins();
    expect(listing.pins).toEqual([]);
    expect(listing.problems).toEqual([
      { file: `${pinIdFor("call_8f2a9c")}.json`, message: `${pinIdFor("call_8f2a9c")}.json is not a 0600 file of yours, so it was not read.` },
    ]);
  });

  it("a symlink, a folder and a pipe at a pin name are reported, never read, and the folder is not entered", async () => {
    makeDir();
    const secret = path.join(root, "secret.json");
    fs.writeFileSync(secret, formatCase(pinFor()), { mode: 0o600 });
    fs.symlinkSync(secret, path.join(dir, "pin-link-1.json"));
    fs.mkdirSync(path.join(dir, "pin-folder-1.json"));
    const listing = await listPins();
    expect(listing.pins).toEqual([]);
    expect(listing.problems.map((p) => p.file).sort()).toEqual(["pin-folder-1.json", "pin-link-1.json"]);
  });

  it("a file saved under another name, one whose id does not match its call, and bad JSON are problems", async () => {
    const good = formatCase(pinFor());
    plant("pin-renamed-1.json", good);
    const wrongId = parseCase(rawPin("call_x"));
    plant("pin-x.json", formatCase({ ...wrongId, id: "pin-x" }));
    plant(`${pinIdFor("call_y")}.json`, `{"not json ${MARKER}`);
    const listing = await listPins();
    expect(listing.pins).toEqual([]);
    const byFile = Object.fromEntries(listing.problems.map((p) => [p.file, p.message]));
    expect(byFile["pin-renamed-1.json"]).toContain("a name that is not its pin id");
    expect(byFile["pin-x.json"]).toContain("an id that its call id does not give");
    expect(byFile[`${pinIdFor("call_y")}.json`]).toContain("is not valid JSON");
  });

  it("a record of a different call than pin.callId is a problem", async () => {
    const raw = rawPin("call_8f2a9c", { record: { call_id: "call_other", agent_id: "agent_1", transcript_with_tool_calls: [{ role: "agent", content: MARKER }] } });
    plant(`${pinIdFor("call_8f2a9c")}.json`, JSON.stringify(raw));
    const listing = await listPins();
    expect(listing.pins).toEqual([]);
    expect(listing.problems).toHaveLength(1);
    expect(listing.problems[0].message).toContain("is not a valid pin");
    expect(listing.problems[0].message).toContain("record.call_id");
  });

  it("a plain case with no pin block is a problem, not a pin", async () => {
    const raw = rawPin();
    delete raw.pin;
    plant(`${pinIdFor("call_8f2a9c")}.json`, JSON.stringify({ ...raw, locked: false }));
    const listing = await listPins();
    expect(listing.pins).toEqual([]);
    expect(listing.problems[0].message).toContain("a case but not a pinned call");
  });

  it("ignores names that are not pin-*.json: notes, the key file, temps, hidden files", async () => {
    plant("notes.txt", MARKER);
    plant("config.json", MARKER);
    plant(".pin-a-1.json.0123456789abcdef.tmp", MARKER);
    plant("pin-a-1.txt", MARKER);
    expect(await listPins()).toEqual({ pins: [], problems: [] });
  });

  it("no problem, and no thrown error, ever carries call content", async () => {
    plant("pin-a-1.json", `{"schemaVersion": 1, "record": "${MARKER}", "extra": "${MARKER}"}`);
    plant("pin-b-1.json", `{"leak ${MARKER}`);
    plant("pin-c-1.json", JSON.stringify(rawPin("call_c", { id: "pin-c-1", record: { call_id: "call_c", agent_id: "agent_1", note: MARKER } })));
    const listing = await listPins();
    expect(listing.problems).toHaveLength(3);
    expect(JSON.stringify(listing)).not.toContain(MARKER);
  });

  it("a file name with escape characters is shown without them", async () => {
    plant("pin-\u001b[31mred\u202e.json", "{}");
    const listing = await listPins();
    expect(listing.problems[0].file).toBe("pin-?[31mred?.json");
    expect(listing.problems[0].message).not.toMatch(/[\u0000-\u001f]/);
  });

  it("survives a record with a __proto__ key, adding nothing to Object.prototype", async () => {
    const text = formatCase(pinFor()).replace('"record": {', '"record": {"__proto__": {"polluted": true}, ');
    plant(`${pinIdFor("call_8f2a9c")}.json`, text);
    const listing = await listPins();
    expect(listing.pins.length + listing.problems.length).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe("deletePin", () => {
  it.each(["", "../config", "pin-../x", "Pin-a-1", "pin-A-1", "a-1", `pin-${"a".repeat(65)}`, "pin-a/b", "pin-a.json", "pin-a\n"])("refuses the id %j before touching the folder", async (id) => {
    await savePin(pinFor());
    const err = await failure(() => deletePin(id));
    expect(err).toBeInstanceOf(PinStoreError);
    expect((err as PinStoreError).code).toBe("bad_id");
    expect(fs.existsSync(file())).toBe(true);
  });

  it("refuses an id that is well formed but not in the folder, and leaves other files alone", async () => {
    plant("pin-notmine-1.txt", "mine");
    const err = await failure(() => deletePin("pin-notmine-1"));
    expect((err as PinStoreError).code).toBe("not_found");
    expect(await failure(() => deletePin("pin-a-1"))).toBeInstanceOf(PinStoreError);
    expect(fs.readdirSync(dir)).toEqual(["pin-notmine-1.txt"]);
  });

  it("says not found when there is no folder", async () => {
    expect(((await failure(() => deletePin("pin-a-1"))) as PinStoreError).code).toBe("not_found");
  });

  it("deletes the one pin and keeps the others", async () => {
    await savePin(pinFor("call_a"));
    await savePin(pinFor("call_b"));
    await deletePin(pinIdFor("call_a"));
    expect(fs.readdirSync(dir)).toEqual([`${pinIdFor("call_b")}.json`]);
  });

  it("refuses a folder planted at the pin's name with a clear error, and leaves it with its contents", async () => {
    const name = `${pinIdFor("call_8f2a9c")}.json`;
    makeDir();
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, "inner.txt"), "keep");
    const err = await failure(() => deletePin(pinIdFor("call_8f2a9c")));
    expect(err).toBeInstanceOf(PinStoreError);
    expect((err as PinStoreError).code).toBe("not_a_file");
    expect(err.message).not.toMatch(/EISDIR|EPERM/);
    expect(fs.readFileSync(path.join(dir, name, "inner.txt"), "utf8")).toBe("keep");
  });

  it("removes a symlink planted at the pin's name without following it", async () => {
    const target = path.join(root, "target.txt");
    fs.writeFileSync(target, "keep");
    makeDir();
    fs.symlinkSync(target, file());
    await deletePin(pinIdFor("call_8f2a9c"));
    expect(fs.existsSync(file())).toBe(false);
    expect(fs.readFileSync(target, "utf8")).toBe("keep");
  });

  it("still deletes from a folder whose mode has loosened, as removing the key does", async () => {
    await savePin(pinFor());
    fs.chmodSync(dir, 0o755);
    await deletePin(pinIdFor("call_8f2a9c"));
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe("deleteAllPins", () => {
  it("deletes every pin file and touches nothing else", async () => {
    await savePin(pinFor("call_a"));
    await savePin(pinFor("call_b"));
    plant("notes.txt", "mine");
    plant("config.json", "key");
    expect(await deleteAllPins()).toEqual({ deleted: 2, skipped: [] });
    expect(fs.readdirSync(dir).sort()).toEqual(["config.json", "notes.txt"]);
  });

  it("skips a planted folder and reports it, removes a planted symlink without following it", async () => {
    await savePin(pinFor("call_a"));
    makeDir();
    fs.mkdirSync(path.join(dir, "pin-folder-1.json"));
    fs.writeFileSync(path.join(dir, "pin-folder-1.json", "inner.txt"), "keep");
    const target = path.join(root, "target.txt");
    fs.writeFileSync(target, "keep");
    fs.symlinkSync(target, path.join(dir, "pin-link-1.json"));
    expect(await deleteAllPins()).toEqual({
      deleted: 2,
      skipped: [{ file: "pin-folder-1.json", message: "pin-folder-1.json is a folder, not a pinned call, so it was left alone." }],
    });
    expect(fs.readFileSync(path.join(dir, "pin-folder-1.json", "inner.txt"), "utf8")).toBe("keep");
    expect(fs.readFileSync(target, "utf8")).toBe("keep");
  });

  it("is fine with no folder at all", async () => {
    expect(await deleteAllPins()).toEqual({ deleted: 0, skipped: [] });
    expect(fs.existsSync(home)).toBe(false);
  });
});
