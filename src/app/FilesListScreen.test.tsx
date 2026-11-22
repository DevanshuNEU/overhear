import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PROBLEM_REASON, type FileProblem } from "@/files/labels";
import type { PullRow } from "@/pull/pull";
import { currentHref, router, visit } from "@/test-utils/fakeNavigation";
import { FilesListScreen } from "./FilesListScreen";
import { FILES_WORDS } from "./filesWords";

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), ...(await import("@/test-utils/fakeNavigation")).navigationMock }));

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  visit("/files");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const base = { startedAt: 1_795_323_170_000, durationMs: 72_000, state: "report" as const, platform: "livekit" as const };
const ROWS: PullRow[] = [
  { ...base, callId: "AJ_pass", verdict: "passed", headline: "Passed.", notes: ["no_promises_made"] },
  { ...base, callId: "AJ_fail", verdict: "failed", headline: "Failed.", lead: "The agent said you're booked, and no booking was made." },
  { ...base, callId: "AJ_review", verdict: "needs_review", headline: "Needs review.", lead: "Couldn't check the date." },
  { ...base, callId: "AJ_idle", verdict: "nothing_done", headline: "Nothing done.", lead: "Nothing done. The caller hung up." },
];
const PROBLEMS: FileProblem[] = [
  { file: "notes.json", reason: "not_json" },
  { file: "huge.json", reason: "too_large" },
];

const show = (props: Partial<React.ComponentProps<typeof FilesListScreen>> = {}) => render(<FilesListScreen rows={ROWS} problems={[]} view="files" timeZone="UTC" {...props} />);
const rowFor = (id: string) => document.querySelector(`[data-call-id="${id}"]`) as HTMLElement;

describe("the list from files", () => {
  it("leads with how many calls failed, then where they were read from", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 of 4 calls failed. Read from 4 session report files on this computer.");
  });

  it("says file and call in the singular for one", () => {
    show({ rows: [ROWS[1]] });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("1 of 1 call failed. Read from 1 session report file on this computer.");
  });

  it("has the two groups, failed and needs review first, then the rest with Passed quiet and Nothing done last", () => {
    show();
    const first = screen.getByRole("list", { name: "Look at these first" });
    expect(within(first).getAllByRole("listitem").map((li) => li.getAttribute("data-call-id"))).toEqual(["AJ_fail", "AJ_review"]);
    const rest = screen.getByRole("list", { name: "Everything else" });
    expect(within(rest).getAllByRole("listitem").map((li) => li.getAttribute("data-call-id"))).toEqual(["AJ_pass", "AJ_idle"]);
    expect(within(rowFor("AJ_pass")).getByText("No promises to check.")).toHaveClass("text-report-muted");
  });

  it("has no check count, no Check again and no Stop", () => {
    show();
    expect(screen.queryByText("Check the last")).toBeNull();
    expect(screen.queryByRole("button", { name: /check again|try again|stop checking/i })).toBeNull();
    expect(screen.getByRole("button", { name: "Open more reports" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("links each row to its report, marked as from the files, and carries the filter", () => {
    show();
    expect(rowFor("AJ_fail").querySelector("a")).toHaveAttribute("href", "/reports/AJ_fail?src=files");
    fireEvent.click(screen.getByRole("link", { name: /Failed 1/ }));
    expect(currentHref()).toBe("/files?show=failed");
    expect(rowFor("AJ_fail").querySelector("a")).toHaveAttribute("href", "/reports/AJ_fail?src=files&from=failed");
  });

  it.each([
    ["failed", ["AJ_fail"]],
    ["needs_review", ["AJ_review"]],
    ["passed", ["AJ_pass"]],
    ["nothing_done", ["AJ_idle"]],
  ])("keeps the filter in the address and shows only %s calls", (filter, ids) => {
    visit(`/files?show=${filter}`);
    show();
    const ul = screen.getAllByRole("list")[0];
    expect(within(ul).getAllByRole("listitem").map((li) => li.getAttribute("data-call-id"))).toEqual(ids);
    expect(document.querySelectorAll("[data-call-id]")).toHaveLength(ids.length);
  });

  it("filters in place on the files path, never to the pull's path", () => {
    show();
    const filters = within(screen.getByRole("navigation", { name: "Show calls" }));
    for (const [name, query] of [[/Failed/, "failed"], [/Needs review/, "needs_review"], [/Passed/, "passed"], [/Nothing done/, "nothing_done"]] as const) {
      fireEvent.click(filters.getByRole("link", { name }));
      expect(currentHref()).toBe(`/files?show=${query}`);
    }
    fireEvent.click(filters.getByRole("link", { name: /^All/ }));
    expect(currentHref()).toBe("/files");
  });

  it("says so under a filter with no matches, and offers the whole list", () => {
    visit("/files?show=failed");
    show({ rows: [ROWS[0]] });
    expect(screen.getByRole("heading", { level: 2, name: "No failed calls in these 1." })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Show all calls" }));
    expect(currentHref()).toBe("/files");
  });

  it("shows the platform on a row only when the set mixes platforms", () => {
    show();
    expect(screen.queryByText("LiveKit")).toBeNull();
    cleanup();
    show({ rows: [ROWS[0], { ...ROWS[1], platform: "retell" }] });
    expect(within(rowFor("AJ_pass")).getByText("LiveKit")).toBeInTheDocument();
    expect(within(rowFor("AJ_fail")).getByText("Retell")).toBeInTheDocument();
  });

  it("shows the file name, faint, on a row that shares its call id with another file, and on no other", () => {
    show({ rows: [{ ...ROWS[1], file: "copy of a.json" }, ROWS[0]] });
    expect(within(rowFor("AJ_fail")).getByText("copy of a.json")).toHaveClass("text-report-muted");
    expect(within(rowFor("AJ_pass")).queryByText(/\.json/)).toBeNull();
  });

  it("lists each file that was set aside under the list as its name and a plain reason", () => {
    show({ problems: PROBLEMS });
    const set = screen.getByRole("region", { name: FILES_WORDS.problemsHeading });
    expect(within(set).getAllByRole("listitem").map((li) => li.textContent)).toEqual([`notes.json: ${PROBLEM_REASON.not_json}`, `huge.json: ${PROBLEM_REASON.too_large}`]);
    const list = screen.getByRole("list", { name: "Look at these first" });
    expect(list.compareDocumentPosition(set) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows only the problems when no call could be read", () => {
    show({ rows: [], problems: PROBLEMS });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No calls could be read. The files that were set aside are listed below.");
    expect(screen.queryByRole("navigation", { name: "Show calls" })).toBeNull();
    expect(screen.getByText(`notes.json: ${PROBLEM_REASON.not_json}`)).toBeInTheDocument();
  });

  it("opens more reports and shows the whole set the server answers with", async () => {
    const more: PullRow = { ...base, callId: "AJ_new", verdict: "failed", headline: "Failed.", lead: "New failure." };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ rows: [more, ...ROWS], problems: PROBLEMS }), { status: 200 }));
    show();
    const input = screen.getByLabelText("Open more reports") as HTMLInputElement;
    expect(input).toHaveAttribute("accept", ".json,application/json");
    expect(input).toHaveAttribute("multiple");
    const file = new File(["{}"], "more.json");
    Object.defineProperty(file, "text", { value: async () => "{}" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(rowFor("AJ_new")).not.toBeNull());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("2 of 5 calls failed. Read from 5 session report files");
    expect(screen.getByText(`notes.json: ${PROBLEM_REASON.not_json}`)).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ files: [{ name: "more.json", text: "{}" }] });
  });

  it("says a fixed sentence when opening more fails, and keeps the list", async () => {
    fetchMock.mockRejectedValue(new Error("boom SECRETTEXT"));
    show();
    const file = new File(["{}"], "more.json");
    Object.defineProperty(file, "text", { value: async () => "{}" });
    fireEvent.change(screen.getByLabelText("Open more reports"), { target: { files: [file] } });
    expect(await screen.findByText(FILES_WORDS.serverDown)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("SECRETTEXT");
    expect(rowFor("AJ_fail")).not.toBeNull();
  });

  it("clears the server's files with DELETE and goes back to the start", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ cleared: true }), { status: 200 }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
    expect(fetchMock).toHaveBeenCalledWith("/api/files", expect.objectContaining({ method: "DELETE" }));
  });

  it("stays where it is and says so when the clear does not go through", async () => {
    fetchMock.mockResolvedValue(new Response("no", { status: 500 }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(await screen.findByText(FILES_WORDS.clearFailed)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
  });

  it("puts Calls on the shell with no key, and Calls and Files with both", () => {
    show();
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Calls", "/files"]]);
    expect(within(nav).getByRole("link", { name: "Calls" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText(FILES_WORDS.navNote)).toBeInTheDocument();
    cleanup();
    show({ view: "both" });
    const both = screen.getByRole("navigation", { name: "Main" });
    expect(within(both).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([["Calls", "/"], ["Files", "/files"], ["Test call", "/test-call"]]);
    expect(within(both).getByRole("link", { name: "Files" })).toHaveAttribute("aria-current", "page");
  });
});
