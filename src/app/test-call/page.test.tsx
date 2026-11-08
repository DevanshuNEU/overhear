import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { KeyStoreError } from "@/pull/key-store";
import TestCallPage, { dynamic } from "./page";
import { TEST_WORDS } from "../testCallWords";

const hasKey = vi.fn<() => Promise<boolean>>();
vi.mock("@/pull/key-store", async (importOriginal) => ({ ...(await importOriginal<object>()), hasKey: () => hasKey() }));

const ORIGINAL = process.env.OVERHEAR_LOCAL;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  hasKey.mockReset();
  if (ORIGINAL === undefined) delete process.env.OVERHEAR_LOCAL;
  else process.env.OVERHEAR_LOCAL = ORIGINAL;
});

/** The digest Next puts on the error `notFound()` or `redirect()` throws. */
async function digestOf(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
  } catch (err) {
    const digest = (err as { digest?: unknown }).digest;
    if (typeof digest === "string") return digest;
    throw err;
  }
  return null;
}

describe("/test-call", () => {
  it("is rendered per request, so the build cannot bake in one mode", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("answers 404 on a hosted copy, and never looks at the key", async () => {
    delete process.env.OVERHEAR_LOCAL;
    expect(await digestOf(() => TestCallPage())).toContain("404");
    expect(hasKey).not.toHaveBeenCalled();
  });

  it("goes back to the connect screen when no key is saved", async () => {
    process.env.OVERHEAR_LOCAL = "1";
    hasKey.mockResolvedValue(false);
    expect(await digestOf(() => TestCallPage())).toMatch(/^NEXT_REDIRECT;[a-z]+;\/;/);
  });

  it("goes back to the connect screen, which explains it, when the key store will not open", async () => {
    process.env.OVERHEAR_LOCAL = "1";
    hasKey.mockRejectedValue(new KeyStoreError("file_unsafe", "x"));
    expect(await digestOf(() => TestCallPage())).toMatch(/^NEXT_REDIRECT;[a-z]+;\/;/);
  });

  it("shows the test call screen in local mode when a key is saved", async () => {
    process.env.OVERHEAR_LOCAL = "1";
    hasKey.mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(await TestCallPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.idleLead);
  });
});
