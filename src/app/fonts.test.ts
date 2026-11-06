// The fonts are self-hosted, so `next build` never fetches Google Fonts. These tests check that no file loads a font
// from Google, that every committed font file has its license next to it, and that the root layout still sets the
// three CSS variables globals.css reads (--font-geist-sans, --font-geist-mono and --font-display).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

type LocalFontOptions = { src: string | { path: string }[]; variable?: string; weight?: string };

// next/font/local only works inside the Next compiler. Here it echoes its options back, so the test can read them.
const calls = vi.hoisted(() => [] as LocalFontOptions[]);
vi.mock("next/font/local", () => ({
  default: (opts: LocalFontOptions) => {
    calls.push(opts);
    return { className: "font", variable: `variable(${opts.variable})`, style: { fontFamily: "font" } };
  },
}));
vi.mock("./globals.css", () => ({}));

const SRC = path.resolve(__dirname, "..");
const FONTS = path.resolve(__dirname, "fonts");

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? files(full) : [full];
  });
}

describe("fonts", () => {
  it("no source file loads a font from Google", () => {
    const offenders = files(SRC)
      .filter((f) => /\.(ts|tsx|css)$/.test(f) && !f.endsWith("fonts.test.ts"))
      .filter((f) => /next\/font\/google|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("every committed font file has an OFL license in its folder", () => {
    const fontFiles = files(FONTS).filter((f) => /\.(woff2?|ttf|otf)$/.test(f));
    expect(fontFiles.length).toBeGreaterThan(0);
    for (const f of fontFiles) {
      const license = path.join(path.dirname(f), "OFL.txt");
      expect(fs.existsSync(license), `${license} is missing`).toBe(true);
      expect(fs.readFileSync(license, "utf8")).toContain("SIL Open Font License, Version 1.1");
    }
  });

  it("the root layout sets the sans, mono and display variables", async () => {
    const { default: RootLayout } = await import("./layout");
    const html = RootLayout({ children: null, params: Promise.resolve({}) });
    const className: string = html.props.className;
    for (const v of ["--font-geist-sans", "--font-geist-mono", "--font-display"]) {
      expect(className).toContain(`variable(${v})`);
    }
  });

  it("the display font points at a committed file and keeps the 500 to 800 weights", async () => {
    await import("./layout");
    const display = calls.find((c) => c.variable === "--font-display");
    expect(display).toBeDefined();
    expect(display?.weight).toBe("500 800");
    const sources = typeof display?.src === "string" ? [display.src] : (display?.src ?? []).map((s) => s.path);
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) expect(fs.existsSync(path.resolve(__dirname, s)), `${s} is missing`).toBe(true);
  });
});
