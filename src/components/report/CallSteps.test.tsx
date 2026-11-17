import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PullRow } from "@/pull/pull";
import { router, visit } from "@/test-utils/fakeNavigation";
import { STEP_LABEL } from "@/report/labels";
import { CallSteps } from "./CallSteps";

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), ...(await import("@/test-utils/fakeNavigation")).navigationMock }));

const report = (callId: string, verdict: "failed" | "needs_review" | "passed" | "nothing_done"): PullRow => ({ callId, startedAt: 1, durationMs: 1, state: "report", verdict, headline: "h" });
// Shown order under All: f1, f2, r1, p1, (e1, w1), p2, n1.
const ROWS: PullRow[] = [
  report("p1", "passed"),
  { callId: "e1", startedAt: 1, durationMs: 1, state: "error" },
  report("r1", "needs_review"),
  { callId: "w1", startedAt: 1, durationMs: 1, state: "pending" },
  report("f1", "failed"),
  report("n1", "nothing_done"),
  report("f2", "failed"),
  report("p2", "passed"),
];

let fetchMock: ReturnType<typeof vi.fn>;
function serve(body: unknown = { rows: ROWS }, status = 200) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
}

function open(callId: string, from?: string) {
  visit(`/reports/${callId}${from ? `?from=${from}` : ""}`, { callId });
  return render(<CallSteps />);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem("overhear.pull", "pull_1");
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const link = (name: string) => screen.getByRole("link", { name });
const none = (name: string) => expect(screen.queryByRole("link", { name })).toBeNull();

describe("the way back", () => {
  it.each([
    [undefined, "Back to all calls", "/"],
    ["failed", "Back to failed calls", "/?show=failed"],
    ["needs_review", "Back to calls that need review", "/?show=needs_review"],
    ["passed", "Back to passed calls", "/?show=passed"],
    ["nothing_done", "Back to calls with nothing done", "/?show=nothing_done"],
  ])("from %s says %s and goes to the list with the same filter", async (from, text, href) => {
    open("f1", from);
    expect(link(text)).toHaveAttribute("href", href);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });

  it("treats a filter it does not know as All", () => {
    open("f1", "bogus");
    expect(link("Back to all calls")).toHaveAttribute("href", "/");
  });
});

describe("Previous and Next", () => {
  it("reads the pull once, by the id the list kept, and never sends a key", async () => {
    open("r1");
    await screen.findByRole("link", { name: STEP_LABEL.next });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/pulls/pull_1", { cache: "no-store" });
  });

  it("in the middle of the list links both ways, in the order the list shows, skipping calls that have no report", async () => {
    open("r1");
    expect(await screen.findByRole("link", { name: STEP_LABEL.previous })).toHaveAttribute("href", "/reports/f2");
    expect(link(STEP_LABEL.next)).toHaveAttribute("href", "/reports/p1");
  });

  it("steps over the calls with no report, so Next from the last passed call before them lands on the next one that has one", async () => {
    open("p1");
    expect(await screen.findByRole("link", { name: STEP_LABEL.next })).toHaveAttribute("href", "/reports/p2");
  });

  it("on the first call shows Previous disabled, not a link", async () => {
    open("f1");
    expect(await screen.findByRole("link", { name: STEP_LABEL.next })).toHaveAttribute("href", "/reports/f2");
    const previous = link(STEP_LABEL.previous);
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(previous).not.toHaveAttribute("href");
  });

  it("on the last call shows Next disabled, not a link", async () => {
    open("n1");
    expect(await screen.findByRole("link", { name: STEP_LABEL.previous })).toHaveAttribute("href", "/reports/p2");
    expect(link(STEP_LABEL.next)).toHaveAttribute("aria-disabled", "true");
    expect(link(STEP_LABEL.next)).not.toHaveAttribute("href");
  });

  it("keeps the filter in both links, and steps only through that filter's calls", async () => {
    open("p1", "passed");
    expect(await screen.findByRole("link", { name: STEP_LABEL.next })).toHaveAttribute("href", "/reports/p2?from=passed");
    expect(link(STEP_LABEL.previous)).toHaveAttribute("aria-disabled", "true");
  });

  it("says the shortcut only in each link's title", async () => {
    open("r1");
    expect(await screen.findByRole("link", { name: STEP_LABEL.next })).toHaveAttribute("title", "Next call (J)");
    expect(link(STEP_LABEL.previous)).toHaveAttribute("title", "Previous call (K)");
    expect(document.body.textContent).not.toMatch(/\(J\)|\(K\)/);
  });

  it("has 44 px targets and a focus ring", async () => {
    open("r1");
    for (const name of [STEP_LABEL.previous, STEP_LABEL.next, "Back to all calls"]) {
      const el = await screen.findByRole("link", { name });
      expect(el).toHaveClass("min-h-11", "focus-visible:outline-2");
    }
  });
});

describe("with nothing to step through, only the way back shows", () => {
  const onlyBack = () => {
    expect(link("Back to all calls")).toBeInTheDocument();
    none(STEP_LABEL.previous);
    none(STEP_LABEL.next);
  };

  it("when the tab has no pull, and asks for nothing", () => {
    window.sessionStorage.clear();
    open("r1");
    onlyBack();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("when the call is not in the pull", async () => {
    open("call_elsewhere");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    onlyBack();
  });

  it("when the call is in the pull but not under the filter it came from", async () => {
    open("p1", "failed");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(link("Back to failed calls")).toBeInTheDocument();
    none(STEP_LABEL.next);
  });

  it("when the fetch fails", async () => {
    fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    open("r1");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    onlyBack();
  });

  it("when the server does not know the pull", async () => {
    serve({ error: "not_found" }, 404);
    open("r1");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    onlyBack();
  });

  it("when the answer is not rows", async () => {
    serve({ rows: "nope" });
    open("r1");
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    onlyBack();
  });
});

describe("the J and K keys", () => {
  const press = (key: string, init: KeyboardEventInit = {}, target: Element | Document = document.body) => fireEvent.keyDown(target, { key, ...init });

  it("J goes to the next call and K to the previous, keeping the filter", async () => {
    open("p1", "passed");
    await screen.findByRole("link", { name: STEP_LABEL.next });
    press("j");
    expect(router.push).toHaveBeenCalledWith("/reports/p2?from=passed");
    cleanup();
    open("r1");
    await screen.findByRole("link", { name: STEP_LABEL.previous });
    press("k");
    expect(router.push).toHaveBeenLastCalledWith("/reports/f2");
  });

  it("does nothing at the end of the list", async () => {
    open("f1");
    await screen.findByRole("link", { name: STEP_LABEL.next });
    press("k");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does nothing before the pull has loaded", () => {
    open("r1");
    press("j");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("J in a focused input does nothing, and neither does it in a textarea, a select or an editable element", async () => {
    open("r1");
    await screen.findByRole("link", { name: STEP_LABEL.next });
    for (const tag of ["input", "textarea", "select"]) {
      const el = document.body.appendChild(document.createElement(tag));
      el.focus();
      press("j", {}, el);
      el.remove();
    }
    const editable = document.body.appendChild(document.createElement("div"));
    editable.setAttribute("contenteditable", "true");
    press("j", {}, editable);
    editable.remove();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does nothing while a modifier key is held", async () => {
    open("r1");
    await screen.findByRole("link", { name: STEP_LABEL.next });
    for (const mod of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) press("j", mod);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("ignores other keys", async () => {
    open("r1");
    await screen.findByRole("link", { name: STEP_LABEL.next });
    press("x");
    press("ArrowRight");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("stops listening when the report closes", async () => {
    const view = open("r1");
    await screen.findByRole("link", { name: STEP_LABEL.next });
    view.unmount();
    press("j");
    expect(router.push).not.toHaveBeenCalled();
  });
});
