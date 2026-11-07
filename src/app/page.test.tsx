import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { CONNECT_MESSAGE } from "@/pull/labels";
import { KeyStoreError } from "@/pull/key-store";
import { CONNECT_WORDS } from "./ConnectScreen";
import Home, { dynamic } from "./page";

const hasKey = vi.fn<() => Promise<boolean>>();
vi.mock("@/pull/key-store", async (importOriginal) => ({ ...(await importOriginal<object>()), hasKey: () => hasKey() }));

const ORIGINAL = process.env.OVERHEAR_LOCAL;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  hasKey.mockReset();
  if (ORIGINAL === undefined) delete process.env.OVERHEAR_LOCAL;
  else process.env.OVERHEAR_LOCAL = ORIGINAL;
});

/** The path `redirect()` was asked to go to, read from the error Next throws for it. */
async function redirectTarget(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
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

  it("redirects to /demo on a hosted copy (OVERHEAR_LOCAL unset)", async () => {
    delete process.env.OVERHEAR_LOCAL;
    expect(await redirectTarget(() => Home())).toBe("/demo");
    expect(hasKey).not.toHaveBeenCalled();
  });

  it("asks for a key in local mode when none is saved, and does not redirect", async () => {
    process.env.OVERHEAR_LOCAL = "1";
    hasKey.mockResolvedValue(false);
    let page: React.ReactNode = null;
    expect(await redirectTarget(async () => (page = await Home()))).toBeNull();
    render(page);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(CONNECT_WORDS.headline);
    expect(screen.getByLabelText(CONNECT_WORDS.fieldLabel)).toBeInTheDocument();
  });

  it("shows the call list in local mode when a key is saved, and starts a pull of the last 25", async () => {
    process.env.OVERHEAR_LOCAL = "1";
    hasKey.mockResolvedValue(true);
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(await Home());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Finding your last 25 calls");
    expect(screen.queryByLabelText(CONNECT_WORDS.fieldLabel)).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/pulls", expect.objectContaining({ method: "POST" })));
  });

  it("says why when the key store refuses to open", async () => {
    process.env.OVERHEAR_LOCAL = "1";
    hasKey.mockRejectedValue(new KeyStoreError("file_unsafe", "x"));
    render(await Home());
    expect(screen.getByRole("status")).toHaveTextContent(CONNECT_MESSAGE.file_unsafe);
  });

  it("falls back to a plain failure for an error it does not know, without its detail", async () => {
    process.env.OVERHEAR_LOCAL = "1";
    hasKey.mockRejectedValue(new Error("boom key_secret123"));
    render(await Home());
    expect(screen.getByRole("status")).toHaveTextContent(CONNECT_MESSAGE.store_failed);
    expect(document.body.textContent).not.toContain("boom");
  });
});
