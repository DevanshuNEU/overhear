// Every word on screen comes from src/report/labels.ts. This reads the screen's component files and fails on
// text typed into JSX or into a text attribute, so a missing word is added to labels.ts and not to a component.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dirs = [__dirname, path.resolve(__dirname, "../../app/reports")];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(e.name) && !/\.test\.tsx$/.test(e.name) ? [full] : [];
  });
}

describe("words live in labels.ts", () => {
  const files = dirs.filter((d) => fs.existsSync(d)).flatMap(sourceFiles);

  it("finds the screen's component files", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  for (const file of files) {
    it(`${path.relative(process.cwd(), file)} types no words into JSX`, () => {
      const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      // Text between tags, and text next to an expression such as `{count} broken`.
      const jsxText = [
        ...code.matchAll(/>([^<>{}=;()]*[A-Za-z]{2,}[^<>{}=;()]*)(?=[<{])/g),
        ...code.matchAll(/}([^<>{}=;()]*[A-Za-z]{2,}[^<>{}=;()]*)</g),
      ].map((m) => m[1].trim()).filter(Boolean);
      const attrs = [...code.matchAll(/\b(?:aria-label|title|alt|placeholder)="([^"]*[A-Za-z][^"]*)"/g)].map((m) => m[1]);
      expect([...jsxText, ...attrs]).toEqual([]);
    });
  }
});
