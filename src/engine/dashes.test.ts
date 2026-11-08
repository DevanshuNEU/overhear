// @vitest-environment node
// No em or en dash in the engine, the pull layer or the pinned-call code: not in code, comments, strings or fixtures, because their
// words reach the screen. The characters are written as escapes so this file does not match itself.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const DASH = /[\u2014\u2013]/;
const ROOTS = ["engine", "pull", "local-store", "pinned"].map((dir) => path.join(__dirname, "..", dir)).filter((dir) => fs.existsSync(dir));

/** Every file under the roots, as a path from src/. */
function files(): string[] {
  return ROOTS.flatMap((root) =>
    (fs.readdirSync(root, { recursive: true }) as string[])
      .map((f) => path.join(root, f))
      .filter((f) => fs.statSync(f).isFile())
      .map((f) => path.relative(path.join(__dirname, ".."), f).split(path.sep).join("/")),
  );
}

describe("no em or en dash", () => {
  it("the check sees both characters", () => {
    expect(DASH.test("a \u2014 b")).toBe(true);
    expect(DASH.test("9\u201310")).toBe(true);
    expect(DASH.test("a - b")).toBe(false);
  });

  it("covers the engine", () => {
    expect(files().some((f) => f.startsWith("engine/"))).toBe(true);
  });

  it.each(files())("src/%s has none", (file) => {
    const lines = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split("\n");
    expect(lines.flatMap((line, i) => (DASH.test(line) ? [`line ${i + 1}: ${line.trim()}`] : []))).toEqual([]);
  });
});
