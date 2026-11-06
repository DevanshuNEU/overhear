// @vitest-environment node
// Rules about where the key can go, checked by reading the source:
// - src/pull imports nothing that reads the demo's environment at import (@/lib/env, @/retell/client, @/db/).
// - Only retell-source.ts reads the stored key, and only it builds a Retell client.
// - The connect route never reads a URL query or a cookie.
// - The local script and the Conductor product action bind 127.0.0.1.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(__dirname, "..");
const ROOT = path.join(SRC, "..");

function sourceFiles(dir: string): string[] {
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .map((f) => path.join(dir, f))
    .filter((f) => /\.(ts|tsx)$/.test(f) && fs.statSync(f).isFile());
}

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");
const read = (file: string) => fs.readFileSync(file, "utf8");

describe("src/pull boundaries", () => {
  it("src/pull imports nothing from @/lib/env, @/retell/client or @/db/", () => {
    const bad = sourceFiles(path.join(SRC, "pull")).filter((f) => /from\s+["'](@\/lib\/env|@\/retell\/client|@\/db\/)/.test(read(f)) || /import\(\s*["'](@\/lib\/env|@\/retell\/client|@\/db\/)/.test(read(f)));
    expect(bad.map(rel)).toEqual([]);
  });

  it("only retell-source.ts reads the stored key", () => {
    const readers = sourceFiles(SRC)
      .filter((f) => !isTest(f) && rel(f) !== "pull/key-store.ts")
      .filter((f) => /\breadKey\b/.test(read(f)));
    expect(readers.map(rel)).toEqual(["pull/retell-source.ts"]);
  });

  it("only retell-source.ts builds a Retell client in src/pull and the product routes", () => {
    const productFiles = [...sourceFiles(path.join(SRC, "pull")), ...sourceFiles(path.join(SRC, "app", "api", "connect"))].filter((f) => !isTest(f));
    const builders = productFiles.filter((f) => /new\s+Retell\s*\(/.test(read(f)) || /import\s+Retell\b/.test(read(f)));
    expect(builders.map(rel)).toEqual(["pull/retell-source.ts"]);
  });

  it("the connect route never reads the key from a URL or a cookie", () => {
    const route = read(path.join(SRC, "app", "api", "connect", "route.ts"));
    for (const banned of ["searchParams", "nextUrl", "cookies", "headers.get(\"cookie\")", "request.url", "req.url"]) {
      expect(route.includes(banned), banned).toBe(false);
    }
  });

  it("no console call in src/pull outside logSafe", () => {
    const calls = sourceFiles(path.join(SRC, "pull"))
      .filter((f) => !isTest(f))
      .flatMap((f) => read(f).split("\n").map((line, i) => ({ file: rel(f), line: i + 1, text: line })))
      .filter(({ text }) => /\bconsole\.\w+\(/.test(text) && !/^\s*(\/\/|\/?\*)/.test(text));
    expect(calls.map(({ file }) => file)).toEqual(["pull/redact.ts"]);
  });
});

describe("the local server binds loopback", () => {
  it("Next still records the address it serves in __NEXT_PRIVATE_ORIGIN, which local mode's bind check reads", () => {
    // If a Next upgrade drops or renames it, local mode refuses every request (it fails closed). This test fails
    // first, at upgrade time, so the check can be moved to whatever Next records instead.
    const startServer = read(path.join(ROOT, "node_modules", "next", "dist", "server", "lib", "start-server.js"));
    expect(startServer).toMatch(/process\.env\.__NEXT_PRIVATE_ORIGIN\s*=\s*appUrl/);
  });

  it("npm run local sets local mode and passes -H 127.0.0.1", () => {
    const pkg = JSON.parse(read(path.join(ROOT, "package.json"))) as { scripts: Record<string, string> };
    expect(pkg.scripts.local).toBe("OVERHEAR_LOCAL=1 next dev -H 127.0.0.1");
  });

  it("the Conductor product run action runs npm run local, never plain npm run dev", () => {
    const toml = read(path.join(ROOT, ".conductor", "settings.toml"));
    const section = /\[scripts\.run\.product\]\n([\s\S]*?)(?:\n\[|$)/.exec(toml);
    expect(section).not.toBeNull();
    const command = /^command\s*=\s*"(.*)"$/m.exec(section![1])?.[1];
    expect(command).toBe("npm run local -- --port $CONDUCTOR_PORT");
  });

  it(".env.example documents OVERHEAR_LOCAL, OVERHEAR_HOME and OVERHEAR_DEMO_STATES", () => {
    const example = read(path.join(ROOT, ".env.example"));
    for (const name of ["OVERHEAR_LOCAL", "OVERHEAR_HOME", "OVERHEAR_DEMO_STATES"]) {
      expect(example).toMatch(new RegExp(`^#?\\s*${name}=`, "m"));
    }
  });
});
