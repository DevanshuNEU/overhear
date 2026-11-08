// @vitest-environment node
// What src/pinned and scripts/*pinned*.ts may import, checked by reading the source. A pin store that could reach the key or the network
// could leak call data or the key. The first piece of code to touch the key for a pin is src/pull/pin.ts, not here.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DIR = __dirname;
const SCRIPTS = path.join(DIR, "..", "..", "scripts");
const inScripts = fs
  .readdirSync(SCRIPTS)
  .filter((f) => /pinned.*\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ file: `scripts/${f}`, text: fs.readFileSync(path.join(SCRIPTS, f), "utf8") }));
const inPinned = fs
  .readdirSync(DIR)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ file: f, text: fs.readFileSync(path.join(DIR, f), "utf8") }));

/** The pinned-call source and its scripts: scripts/check-pinned.ts has the same limits as the store. */
const sources = [...inPinned, ...inScripts];

/** Every module a file imports or requires, as written. */
const importsOf = (text: string): string[] => [...text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);

const BANNED = [
  /^@\/pull\//,
  /key-store/,
  /retell-source/,
  /^retell-sdk/,
  /^@\/retell\//,
  /^@\/lib\/env/,
  /^@\/db\//,
  /^node:(http|https|http2|net|tls|dgram|dns|child_process)$/,
  /^(http|https|net|tls|axios|undici|node-fetch)$/,
];

describe("src/pinned boundaries", () => {
  it("has source files to check", () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(["store.ts", "check.ts", "format.ts", "scripts/check-pinned.ts"]));
  });

  it.each(sources)("$file imports no key store, Retell source or SDK, env or database, or network module", ({ text }) => {
    const bad = importsOf(text).filter((spec) => BANNED.some((re) => re.test(spec)));
    expect(bad).toEqual([]);
  });

  it.each(sources)("$file makes no network call and writes no log", ({ text }) => {
    const code = text.split("\n").filter((line) => !/^\s*(\/\/|\/?\*)/.test(line)).join("\n");
    expect(/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bconsole\.\w+\(/.test(code)).toBe(false);
  });

  it.each(sources)("$file never reads the stored key", ({ text }) => {
    expect(/\breadKey\b|\breadStoredKey\b/.test(text)).toBe(false);
  });
});
