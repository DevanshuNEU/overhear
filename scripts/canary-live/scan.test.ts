// @vitest-environment node
// The live canary's search bites: it finds the key in every form, in a text file, a binary file and a file name
// deep in a tree, and it does not flag a clean tree. (The run against a real server is scripts/canary-live.ts.)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makeSearcher } from "./scan";

const KEY = "Zq7LIVEcanaryAb12Cd34W";
const canary = { key: KEY, marker: KEY };
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-scan-test-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("makeSearcher.inText", () => {
  const { inText } = makeSearcher(canary);

  it("finds the key as plain text, hex, base64 at any alignment, Basic auth and an 8-character window", () => {
    expect(inText(`GET /probe/${KEY} 404`)).toBe("the key in plain text");
    expect(inText(Buffer.from(KEY).toString("hex"))).toMatch(/hex/);
    expect(inText(Buffer.from(KEY).toString("hex").toUpperCase())).toMatch(/hex/);
    for (const prefix of ["", "a", "ab", "abc", "Bearer ", "user:"]) {
      expect(inText(Buffer.from(`${prefix}${KEY} tail`).toString("base64")), prefix).not.toBeNull();
      expect(inText(Buffer.from(prefix + KEY).toString("base64url")), prefix).not.toBeNull();
    }
    expect(inText(`Authorization: Basic ${Buffer.from(`user:${KEY}`).toString("base64")}`)).not.toBeNull();
    expect(inText(`"${KEY.slice(5, 13)}"`)).toBe("an 8-character window of the key");
  });

  it("finds it inside a binary buffer", () => {
    const bytes = Buffer.concat([Buffer.from([0, 255, 1, 2]), Buffer.from(KEY), Buffer.from([9, 0, 0])]);
    expect(inText(bytes)).not.toBeNull();
  });

  it("passes text that holds none of it", () => {
    expect(inText("GET /api/connect 200 in 12ms, Authorization: Bearer [redacted]")).toBeNull();
    expect(inText(Buffer.from([0, 1, 2, 3, 250, 251]))).toBeNull();
  });

  it("never names the key in what it says it found", () => {
    const said = [KEY, `x ${KEY.slice(0, 8)}`, Buffer.from(KEY).toString("hex")].map((t) => inText(t));
    for (const s of said) expect(s).not.toContain(KEY);
  });
});

describe("makeSearcher.inTree", () => {
  const { inTree } = makeSearcher(canary);

  it("names each file that holds the key, deep in the tree, and leaves the rest", () => {
    fs.mkdirSync(path.join(dir, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(dir, "clean.txt"), "nothing here");
    fs.writeFileSync(path.join(dir, "a", "b", "cache.bin"), Buffer.concat([Buffer.from([1, 2, 3]), Buffer.from(KEY)]));
    fs.writeFileSync(path.join(dir, "a", "log.txt"), `x ${Buffer.from(KEY).toString("base64")} y`);
    const found = inTree(dir, "next").map((f) => f.place).sort();
    expect(found).toEqual(["next/a/b/cache.bin", "next/a/log.txt"]);
  });

  it("finds a key in a file name and skips files it is told to", () => {
    fs.writeFileSync(path.join(dir, `.${KEY}.tmp`), "");
    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({ retellApiKey: KEY }));
    const found = inTree(dir, "home", (f) => path.basename(f) === "config.json").map((f) => f.place);
    expect(found).toEqual([`home/.${KEY}.tmp (its name)`]);
  });

  it("does not follow a symlink out of the tree", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "overhear-scan-outside-"));
    try {
      fs.writeFileSync(path.join(outside, "secret.txt"), KEY);
      fs.symlinkSync(outside, path.join(dir, "link"));
      expect(inTree(dir, "x")).toEqual([]);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("returns nothing for a folder that does not exist", () => {
    expect(inTree(path.join(dir, "missing"), "x")).toEqual([]);
  });
});
