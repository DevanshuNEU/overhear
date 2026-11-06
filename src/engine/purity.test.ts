// @vitest-environment node
// The engine is pure: the same call and options give the same report on any machine, in a browser, in the eval
// harness and in a later CLI. This guard reads every engine source file and fails on anything that reaches
// outside: Node APIs, the network, the clock, randomness, the machine's locale, or an import from elsewhere.
// zod is the one outside import: it is pure, @/report/schema is built on it, and the eval case format
// (eval/case.ts) validates with it. Test files and testing/ are exempt, since they run only under Vitest.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ENGINE = __dirname;

const BANNED: { what: string; pattern: RegExp }[] = [
  { what: "a Node API", pattern: /["']node:|\bprocess\b|\brequire\(|\bBuffer\b/ },
  {
    what: "a Node module",
    pattern: /from ["'](fs|fs\/promises|path|os|http|https|net|child_process|crypto|stream|url|util|events)["']/,
  },
  { what: "the network", pattern: /\bfetch\(|\bXMLHttpRequest\b|\bWebSocket\b/ },
  { what: "the clock", pattern: /\bDate\.now\b|new Date\(|\bDate\(\)|\bperformance\.|\bset(Timeout|Interval|Immediate)\(/ },
  { what: "randomness", pattern: /Math\.random|\bcrypto\./ },
  // Intl with no locale formats in the machine's locale. Name one, such as "en-US", so output never depends on it.
  { what: "the machine's locale", pattern: /\bIntl\.\w+\(\s*(\)|undefined\b)|\btoLocale\w*\(\s*(\)|undefined\b)/ },
];

/** Every module specifier a source file names: static imports, re-exports, side-effect and dynamic imports. */
function specifiers(src: string): string[] {
  const found = [...src.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(?\s*["']([^"']+)["']/g)];
  return found.map((m) => m[1] ?? m[2]);
}

/** Why a source file is impure, one line per problem; empty when it is pure. */
function impurities(src: string): string[] {
  const problems = BANNED.filter((b) => b.pattern.test(src)).map((b) => `uses ${b.what}: ${src.match(b.pattern)![0]}`);
  for (const spec of specifiers(src)) {
    if (!spec.startsWith("./") && !spec.startsWith("../") && !spec.startsWith("@/report/") && spec !== "zod") {
      problems.push(`imports ${spec}, but the engine imports only itself, @/report/ and zod`);
    }
  }
  return problems;
}

/** The engine's own source files: .ts and .tsx, not tests, not testing/. */
function sourceFiles(): string[] {
  return (fs.readdirSync(ENGINE, { recursive: true }) as string[])
    .map((f) => f.split(path.sep).join("/"))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.startsWith("testing/"));
}

describe("the guard", () => {
  it.each([
    ['import fs from "fs";', "a Node module"],
    ['import { readFile } from "node:fs/promises";', "a Node API"],
    ["const home = process.env.HOME;", "a Node API"],
    ['const x = require("x");', "a Node API"],
    ['Buffer.from("a");', "a Node API"],
    ["await fetch(url);", "the network"],
    ["const t = Date.now();", "the clock"],
    ["const d = new Date(0);", "the clock"],
    ["const s = Date();", "the clock"],
    ["performance.now();", "the clock"],
    ["setTimeout(f, 1);", "the clock"],
    ["Math.random();", "randomness"],
    ["crypto.randomUUID();", "randomness"],
    ["new Intl.DateTimeFormat(undefined, { timeZone });", "the machine's locale"],
    ["Intl.DateTimeFormat().resolvedOptions().timeZone;", "the machine's locale"],
    ["n.toLocaleString();", "the machine's locale"],
  ])("catches %s", (src, what) => {
    expect(impurities(src).join("\n")).toContain(`uses ${what}`);
  });

  it.each([
    'import _ from "lodash";',
    'import { z } from "zod/v4";',
    'export { x } from "@/lib/env";',
    'import "server-only";',
    'const m = await import("@/db/client");',
    'import { CONTRACT_TITLE } from "@/reporting/labels";',
  ])("catches an import from outside the engine, @/report/ and zod: %s", (src) => {
    expect(impurities(src).join("\n")).toMatch(/imports .+, but the engine imports only itself/);
  });

  it.each([
    'import type { Evidence } from "@/report/schema";',
    'import { CONTRACT_TITLE } from "@/report/labels";',
    'import { isPlaceholder } from "./placeholder";',
    'import { z } from "zod";',
    'export * from "../types";',
    'new Intl.DateTimeFormat("en-US", { timeZone: tz });',
    "const ms = Date.UTC(2026, 10, 2);",
  ])("lets through %s", (src) => {
    expect(impurities(src)).toEqual([]);
  });
});

describe("src/engine is pure", () => {
  it("has source files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it.each(sourceFiles())("%s uses no Node API, network, clock, randomness or machine locale, and imports only itself, @/report/ and zod", (file) => {
    expect(impurities(fs.readFileSync(path.join(ENGINE, file), "utf8"))).toEqual([]);
  });
});
