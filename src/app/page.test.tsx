import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Home, { dynamic } from "./page";

const ORIGINAL = process.env.OVERHEAR_LOCAL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.OVERHEAR_LOCAL;
  else process.env.OVERHEAR_LOCAL = ORIGINAL;
});

/** The path `redirect()` was asked to go to, read from the error Next throws for it. */
function redirectTarget(fn: () => unknown): string | null {
  try {
    fn();
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;")) return digest.split(";")[2] ?? null;
    throw err;
  }
  return null;
}

describe("/", () => {
  it("is rendered per request, so the build cannot bake in one mode", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("redirects to /demo on a hosted copy (OVERHEAR_LOCAL unset)", () => {
    delete process.env.OVERHEAR_LOCAL;
    expect(redirectTarget(() => Home())).toBe("/demo");
  });

  it("shows the product shell in local mode and does not redirect", () => {
    process.env.OVERHEAR_LOCAL = "1";
    expect(redirectTarget(() => Home())).toBeNull();
    render(Home());
    expect(screen.getByRole("heading", { level: 1, name: "Overhear" })).toBeInTheDocument();
  });
});
