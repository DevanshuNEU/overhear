import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { CONNECT_MESSAGE } from "@/pull/labels";
import { KeyStoreError } from "@/pull/key-store";
import { CONNECT_WORDS } from "./ConnectScreen";
import { signOwnerCookie } from "@/demo-call/owner";
import Home, { dynamic } from "./page";

const cookieJar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "overhear_owner" && cookieJar.value ? { name, value: cookieJar.value } : undefined) }),
}));
vi.mock("@/lib/env", () => ({ env: { RETELL_API_KEY: "key_test_secret" } }));

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), ...(await import("@/test-utils/fakeNavigation")).navigationMock }));

const hasKey = vi.fn<() => Promise<boolean>>();
vi.mock("@/pull/key-store", async (importOriginal) => ({ ...(await importOriginal<object>()), hasKey: () => hasKey() }));

const ORIGINAL = process.env.OVERHEAR_LOCAL;

afterEach(() => {
  cleanup();
  cookieJar.value = undefined;
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

const OWNER_LINE = "You’re signed in as the owner for 12 hours. Your calls skip the visitor limits.";

describe("/ owner line", () => {
  const show = async (search: Record<string, string>) => {
    delete process.env.OVERHEAR_LOCAL;
    render(await Home({ searchParams: Promise.resolve(search) }));
  };
  it("shows with a valid owner cookie and owner=1", async () => {
    cookieJar.value = signOwnerCookie("key_test_secret");
    await show({ owner: "1" });
    expect(screen.getByText(OWNER_LINE)).toBeInTheDocument();
  });
  it("does not show with the query alone", async () => {
    await show({ owner: "1" });
    expect(screen.queryByText(OWNER_LINE)).toBeNull();
  });
  it("does not show with a forged cookie", async () => {
    cookieJar.value = signOwnerCookie("some_other_key");
    await show({ owner: "1" });
    expect(screen.queryByText(OWNER_LINE)).toBeNull();
  });
  it("does not show with a valid cookie but no query", async () => {
    cookieJar.value = signOwnerCookie("key_test_secret");
    await show({});
    expect(screen.queryByText(OWNER_LINE)).toBeNull();
  });
});

describe("/", () => {
  it("is rendered per request, so the build cannot bake in one mode", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("shows the sample calls on a hosted copy (OVERHEAR_LOCAL unset), without a redirect or a look at the key", async () => {
    delete process.env.OVERHEAR_LOCAL;
    let page: React.ReactNode = null;
    expect(await redirectTarget(async () => (page = await Home()))).toBeNull();
    render(page);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^\d+ of 9 sample calls failed\./);
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
