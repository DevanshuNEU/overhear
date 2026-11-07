import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CONNECT_MESSAGE } from "@/pull/labels";
import { headlineFor } from "@/report/labels";
import type { PullProgress } from "@/pull/pull";
import { CONNECT_WORDS } from "./ConnectScreen";
import { HomeScreen } from "./HomeScreen";
import { LIST_WORDS } from "./callListWords";

const LOCATION = "~/.overhear/config.json";
const KEY = "key_0123456789abcdef0123456789ab";

const done: PullProgress = {
  id: "pull_1",
  phase: "done",
  requested: 25,
  listed: 1,
  skipped: 0,
  done: 1,
  failed: 0,
  waitingUntil: null,
  rows: [{ callId: "call_1", startedAt: Date.UTC(2026, 10, 6, 15, 42), durationMs: 90_000, state: "report", verdict: "passed", headline: headlineFor("passed", [], []) }],
};

let progress: PullProgress;
let connectAnswer: () => Response;
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  window.sessionStorage.clear();
  progress = done;
  connectAnswer = () => new Response(JSON.stringify({ connected: true }), { status: 200 });
  fetchMock.mockImplementation(async (input, init) => {
    const key = `${init?.method ?? "GET"} ${String(input)}`;
    if (key === "POST /api/pulls") return new Response(JSON.stringify({ id: "pull_1" }), { status: 202 });
    if (key === "GET /api/pulls/pull_1") return new Response(JSON.stringify(progress), { status: 200 });
    if (key === "DELETE /api/connect") return new Response(JSON.stringify({ connected: false }), { status: 200 });
    if (key === "POST /api/connect") return connectAnswer();
    throw new Error(`unexpected ${key}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("the home screen", () => {
  it("opens the call list when a key is saved", async () => {
    render(<HomeScreen stored location={LOCATION} />);
    await waitFor(() => expect(document.querySelector("li[data-call-id=call_1]")).not.toBeNull());
    expect(screen.queryByLabelText(CONNECT_WORDS.fieldLabel)).toBeNull();
  });

  it("opens the connect screen when no key is saved, and the call list once Retell accepts one", async () => {
    render(<HomeScreen stored={false} location={LOCATION} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(CONNECT_WORDS.headline);
    fireEvent.change(screen.getByLabelText(CONNECT_WORDS.fieldLabel), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: CONNECT_WORDS.connect }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/calls/));
    expect(screen.queryByLabelText(CONNECT_WORDS.fieldLabel)).toBeNull();
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it("goes back to the connect screen when the key is disconnected, and then to the list again on a new key", async () => {
    render(<HomeScreen stored location={LOCATION} />);
    await screen.findByRole("button", { name: LIST_WORDS.disconnect });
    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.disconnect }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(CONNECT_WORDS.headline));
    expect(fetchMock).toHaveBeenCalledWith("/api/connect", expect.objectContaining({ method: "DELETE" }));
    // Nothing is said about a rejected key: the person asked for this.
    expect(screen.getByRole("status")).not.toHaveTextContent(CONNECT_MESSAGE.bad_key);
    fireEvent.change(screen.getByLabelText(CONNECT_WORDS.fieldLabel), { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: CONNECT_WORDS.connect }));
    await waitFor(() => expect(screen.queryByLabelText(CONNECT_WORDS.fieldLabel)).toBeNull());
  });

  it("goes back to the connect screen and says so when Retell stops accepting the key mid-pull", async () => {
    progress = { ...done, phase: "failed", error: { code: "bad_key", message: "x" } };
    render(<HomeScreen stored location={LOCATION} />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(CONNECT_WORDS.headline));
    expect(screen.getByRole("status")).toHaveTextContent(CONNECT_MESSAGE.bad_key);
    expect(screen.getByRole("status")).toHaveTextContent(CONNECT_WORDS.badKeyNext);
  });
});
