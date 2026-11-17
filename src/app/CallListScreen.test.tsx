import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PullProgress, PullRow } from "@/pull/pull";
import { PULL_ERROR_MESSAGE } from "@/pull/labels";
import { answerOf } from "@/components/report/answer";
import { RESULT_LABEL, VERDICT_LABEL, headlineFor } from "@/report/labels";
import { failedSample, needsReviewSample } from "@/report/samples";
import { CallListScreen } from "./CallListScreen";
import { LIST_WORDS } from "./callListWords";
import { CONNECT_WORDS } from "./ConnectScreen";
import { currentHref, router, visit } from "@/test-utils/fakeNavigation";

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), ...(await import("@/test-utils/fakeNavigation")).navigationMock }));

const LOCATION = "~/.overhear/config.json";
const T0 = Date.UTC(2026, 10, 6, 15, 42);
const HOUR = 3_600_000;

const FAILED_LINE = headlineFor("failed", [], []);
const REVIEW_LINE = headlineFor("needs_review", [], [{ kind: "deferral" }]);
const PASSED_LINE = headlineFor("passed", [], []);
const NOTHING_DONE_LINE = headlineFor("nothing_done", [], []);

function row(i: number, patch: Partial<PullRow> = {}): PullRow {
  return { callId: `call_${i}`, startedAt: T0 - i * HOUR, durationMs: 161_000, state: "pending", ...patch };
}
// The lead is what the call screen leads with (answerOf), so each failed call says what went wrong in its own words.
const FAILED_LEAD = answerOf(failedSample)!.text;
const REVIEW_LEAD = answerOf(needsReviewSample)!.text;
const failedRow = (i: number) => row(i, { state: "report", verdict: "failed", headline: FAILED_LINE, lead: FAILED_LEAD });
const reviewRow = (i: number, problems = 0) => row(i, { state: "report", verdict: "needs_review", headline: REVIEW_LINE, lead: REVIEW_LEAD, ...withProblems(problems) });
const withProblems = (n: number): Partial<PullRow> => (n > 0 ? { experienceProblems: n } : {});
const passedRow = (i: number, problems = 0) => row(i, { state: "report", verdict: "passed", headline: PASSED_LINE, ...withProblems(problems) });
const nothingDoneRow = (i: number) => row(i, { state: "report", verdict: "nothing_done", headline: NOTHING_DONE_LINE });
const noContentRow = (i: number) => row(i, { state: "no_content" });
const errorRow = (i: number) => row(i, { state: "error" });

function progress(rows: PullRow[], patch: Partial<PullProgress> = {}): PullProgress {
  const finished = rows.filter((r) => r.state === "report" || r.state === "no_content").length;
  return {
    id: "pull_1",
    phase: "fetching",
    requested: 25,
    listed: rows.length,
    skipped: 0,
    done: finished,
    failed: rows.filter((r) => r.state === "error").length,
    waitingUntil: null,
    rows,
    ...patch,
  };
}
const done = (rows: PullRow[], patch: Partial<PullProgress> = {}) => progress(rows, { phase: "done", ...patch });

type Call = { method: string; url: string; body: unknown };

/**
 * A fake local server. The polled endpoint answers the current script entry. The script moves on only when the test
 * says so (next) or the person does something the server would act on (a stop or a retry), so no test races a timer.
 */
function fakeServer(script: PullProgress[], overrides: Record<string, () => Response | Promise<Response>> = {}) {
  const calls: Call[] = [];
  let step = 0;
  const next = () => {
    step = Math.min(step + 1, script.length - 1);
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    const key = `${method} ${url}`;
    if (overrides[key]) return overrides[key]();
    if (key === "POST /api/pulls") return json({ id: "pull_1" }, 202);
    if (key === "GET /api/pulls/pull_1") return json(script[step]);
    if (key === "POST /api/pulls/pull_1/cancel") {
      next();
      return json({ id: "pull_1" });
    }
    if (method === "POST" && /^\/api\/calls\/[^/]+\/refetch$/.test(url)) {
      next();
      return json({ callId: "x", state: "report" });
    }
    if (key === "DELETE /api/connect") return json({ connected: false });
    throw new Error(`unexpected ${key}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, next, count: (method: string, url: string) => calls.filter((c) => c.method === method && c.url === url).length };
}

const onDisconnected = vi.fn();

function renderList(props: Partial<React.ComponentProps<typeof CallListScreen>> = {}) {
  return render(<CallListScreen location={LOCATION} onDisconnected={onDisconnected} timeZone="UTC" pollMs={5} now={() => 1_000_000} {...props} />);
}

const h1 = () => screen.getByRole("heading", { level: 1 });
const rowOf = (callId: string) => document.querySelector(`li[data-call-id="${callId}"]`) as HTMLElement;
const rowFor = (i: number) => rowOf(`call_${i}`);
const findRow = (callId: string) => waitFor(() => expect(rowOf(callId)).not.toBeNull()).then(() => rowOf(callId));
const idsInOrder = () => [...document.querySelectorAll("li[data-call-id]")].map((el) => el.getAttribute("data-call-id"));

beforeEach(() => {
  window.sessionStorage.clear();
  visit("/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onDisconnected.mockReset();
});

describe("before the list lands", () => {
  it("opens a pull of the last 25 on its own and says it is finding them", async () => {
    const server = fakeServer([progress([], { phase: "listing", listed: null })]);
    renderList();
    expect(h1()).toHaveTextContent("Finding your last 25 calls");
    await waitFor(() => expect(server.count("POST", "/api/pulls")).toBe(1));
    expect(server.calls.find((c) => c.method === "POST" && c.url === "/api/pulls")?.body).toEqual({ n: 25 });
    await waitFor(() => expect(server.count("GET", "/api/pulls/pull_1")).toBeGreaterThan(0));
    expect(h1()).toHaveTextContent("Finding your last 25 calls");
    expect(screen.queryByRole("list", { name: LIST_WORDS.listLabel })).toBeNull();
  });

  it("joins the pull that is already running when Overhear says one is", async () => {
    const server = fakeServer([progress([row(1)], { requested: 50 })], {
      "POST /api/pulls": () => new Response(JSON.stringify({ error: "pull_running", id: "pull_1" }), { status: 409 }),
    });
    renderList();
    await waitFor(() => expect(h1()).toHaveTextContent("Checked 0 of 1 calls"));
    expect(server.count("GET", "/api/pulls/pull_1")).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "50" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the pull this tab already has instead of starting another", async () => {
    window.sessionStorage.setItem("overhear.pull", "pull_1");
    const server = fakeServer([done([passedRow(1)])]);
    renderList();
    await findRow("call_1");
    expect(server.count("POST", "/api/pulls")).toBe(0);
  });

  it("starts a new pull when the remembered one is gone", async () => {
    window.sessionStorage.setItem("overhear.pull", "pull_old");
    const server = fakeServer([done([passedRow(1)])], {
      "GET /api/pulls/pull_old": () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }),
    });
    renderList();
    await findRow("call_1");
    expect(server.count("POST", "/api/pulls")).toBe(1);
  });
});

describe("while calls are checked", () => {
  it("shows skeleton rows with real call times, then fills the verdicts in", async () => {
    const server = fakeServer([progress([row(0), row(1)]), progress([failedRow(0), row(1)]), done([failedRow(0), passedRow(1)])]);
    renderList();
    const first = await findRow("call_0");
    expect(first).toHaveTextContent("Nov 6, 15:42");
    expect(rowFor(1)).toHaveTextContent("Nov 6, 14:42");
    expect(rowFor(1)).toHaveTextContent("2 min 41 s");
    // Nothing is said about a call that has not been checked.
    expect(within(rowFor(1)).queryByText(VERDICT_LABEL.passed)).toBeNull();
    expect(within(rowFor(1)).getByText(LIST_WORDS.checking)).toBeInTheDocument();
    server.next();
    await waitFor(() => expect(within(rowFor(0)).getByText(VERDICT_LABEL.failed)).toBeInTheDocument());
    expect(within(rowFor(1)).getByText(LIST_WORDS.checking)).toBeInTheDocument();
    server.next();
    await waitFor(() => expect(within(rowFor(1)).getByText(VERDICT_LABEL.passed)).toBeInTheDocument());
    expect(rowFor(1)).toHaveTextContent(LIST_WORDS.everyPromiseKept);
  });

  it("says how many are checked, out of how many were listed", async () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((i) => passedRow(i));
    for (let i = 8; i <= 25; i++) rows.push(row(i));
    fakeServer([progress(rows)]);
    renderList();
    await waitFor(() => expect(h1()).toHaveTextContent("Checked 7 of 25 calls"));
    expect(screen.getByRole("progressbar", { name: LIST_WORDS.progressLabel })).toHaveAttribute("aria-valuenow", "7");
  });

  it("reads 12 calls, never of 25, when the account holds only 12", async () => {
    const rows = [1, 2, 3].map((i) => passedRow(i));
    for (let i = 4; i <= 12; i++) rows.push(row(i));
    fakeServer([progress(rows, { requested: 25, listed: 12 })]);
    renderList();
    await waitFor(() => expect(h1()).toHaveTextContent("Checked 3 of 12 calls"));
    expect(document.body.textContent).not.toContain("of 25");
    expect(screen.getByLabelText(LIST_WORDS.summaryLabel)).toHaveTextContent("All 12");
  });

  it("says Retell asked for a pause, with the seconds left", async () => {
    fakeServer([progress([row(1)], { waitingUntil: 1_004_000 })]);
    renderList();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Retell asked us to slow down. Continuing in 4 s."));
  });

  it("puts a failed call above the passed ones as soon as it is found, even when it was listed last", async () => {
    const rows = [passedRow(1), passedRow(2), passedRow(3), failedRow(4)];
    fakeServer([progress(rows)]);
    renderList();
    await findRow("call_4");
    expect(idsInOrder()).toEqual(["call_4", "call_1", "call_2", "call_3"]);
  });

  it("stops on request and keeps the calls already finished", async () => {
    const running = progress([failedRow(1), passedRow(2), row(3), row(4)]);
    const server = fakeServer([running, progress([failedRow(1), passedRow(2), row(3), row(4)], { phase: "cancelled" })]);
    renderList();
    await findRow("call_1");
    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.stop }));
    await waitFor(() => expect(server.count("POST", "/api/pulls/pull_1/cancel")).toBe(1));
    await waitFor(() => expect(h1()).toHaveTextContent("Stopped after 2 of 4 calls"));
    expect(within(rowFor(1)).getByText(VERDICT_LABEL.failed)).toBeInTheDocument();
    expect(within(rowFor(2)).getByText(VERDICT_LABEL.passed)).toBeInTheDocument();
    // A call that was never checked says so, and says nothing else.
    expect(within(rowFor(3)).getByText(RESULT_LABEL.not_run)).toBeInTheDocument();
    expect(rowFor(3).querySelector("a")).toBeNull();
    // The summary counts the two it never reached, so its numbers add up to the total.
    expect(screen.getByLabelText(LIST_WORDS.summaryLabel)).toHaveTextContent(`2 ${RESULT_LABEL.not_run}`);
    expect(screen.queryByRole("button", { name: LIST_WORDS.stop })).toBeNull();
    expect(screen.getByRole("button", { name: LIST_WORDS.checkAgain })).toBeEnabled();
  });
});

describe("when the pull is done", () => {
  it("counts failed, needs review and passed with the verdict words, and the total", async () => {
    fakeServer([done([failedRow(1), failedRow(2), reviewRow(3), passedRow(4), passedRow(5), passedRow(6)])]);
    renderList();
    const summary = await screen.findByLabelText(LIST_WORDS.summaryLabel);
    expect(summary).toHaveTextContent(`${LIST_WORDS.all} 6`);
    expect(summary).toHaveTextContent(`${VERDICT_LABEL.failed} 2`);
    expect(summary).toHaveTextContent(`${VERDICT_LABEL.needs_review} 1`);
    expect(summary).toHaveTextContent(`${VERDICT_LABEL.passed} 3`);
    expect(h1()).toHaveTextContent("2 of 6 calls failed.");
  });

  it("counts calls with no transcript and calls that did not load, so the counts add up", async () => {
    fakeServer([done([failedRow(1), noContentRow(2), noContentRow(3), errorRow(4)])]);
    renderList();
    const summary = await screen.findByLabelText(LIST_WORDS.summaryLabel);
    expect(summary).toHaveTextContent(`2 ${RESULT_LABEL.not_run}`);
    expect(summary).toHaveTextContent(`1 ${LIST_WORDS.couldntLoad}`);
  });

  it("shows a failed call without scrolling: it is the first row, whatever its place in the 25", async () => {
    const rows = Array.from({ length: 24 }, (_, i) => passedRow(i + 1));
    rows.push(failedRow(25));
    fakeServer([done(rows)]);
    renderList();
    await findRow("call_25");
    expect(idsInOrder()[0]).toBe("call_25");
    expect(screen.getByRole("heading", { level: 2, name: LIST_WORDS.attentionHeading })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: LIST_WORDS.restHeading })).toBeInTheDocument();
  });

  it("puts no group headings on a list where nothing needs a look", async () => {
    fakeServer([done([passedRow(1), passedRow(2)])]);
    renderList();
    await findRow("call_1");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("counts Nothing done calls in the summary, apart from passed, and lists them after the passed ones", async () => {
    fakeServer([done([nothingDoneRow(1), passedRow(2), passedRow(3), nothingDoneRow(4)])]);
    renderList();
    const summary = await screen.findByLabelText(LIST_WORDS.summaryLabel);
    expect(summary).toHaveTextContent(`${VERDICT_LABEL.passed} 2`);
    expect(summary).toHaveTextContent(`${VERDICT_LABEL.nothing_done} 2`);
    expect(idsInOrder()).toEqual(["call_2", "call_3", "call_1", "call_4"]);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("shows a Nothing done row as quietly as a passed one, with its headline in muted type, not bold", async () => {
    fakeServer([done([nothingDoneRow(1), failedRow(2)])]);
    renderList();
    const quiet = await findRow("call_1");
    expect(within(quiet).getByText(VERDICT_LABEL.nothing_done)).toBeInTheDocument();
    const line = within(quiet).getByText(NOTHING_DONE_LINE.replace(/^Nothing done\. /, ""));
    expect(quiet).not.toHaveTextContent(NOTHING_DONE_LINE);
    expect(line).toHaveClass("text-report-muted");
    expect(line).not.toHaveClass("font-medium");
    const loud = within(rowFor(2)).getByText(FAILED_LEAD);
    expect(loud).toHaveClass("font-medium");
  });

  it("says in a row that the call has call experience problems, in quiet type, for any verdict", async () => {
    fakeServer([done([passedRow(1, 1), failedRow(2), reviewRow(3, 2)])]);
    renderList();
    await findRow("call_1");
    const hint = within(rowFor(1)).getByText("Call experience: 1 problem");
    expect(hint).not.toHaveClass("font-medium");
    expect(hint.className).not.toMatch(/critical|warning/);
    expect(within(rowFor(3)).getByText("Call experience: 2 problems")).toBeInTheDocument();
    expect(within(rowFor(2)).queryByText(/Call experience/)).toBeNull();
  });

  it("links a call with a report to its report, and the rows read time, length, verdict and headline", async () => {
    fakeServer([done([failedRow(1), reviewRow(2), passedRow(3)])]);
    renderList();
    await findRow("call_1");
    for (const i of [1, 2, 3]) {
      const link = rowFor(i).querySelector("a");
      expect(link).toHaveAttribute("href", `/reports/call_${i}`);
    }
    const failed = rowFor(1);
    expect(failed).toHaveTextContent("Nov 6, 14:42");
    expect(failed).toHaveTextContent("2 min 41 s");
    expect(failed).toHaveTextContent(VERDICT_LABEL.failed);
    expect(failed).toHaveTextContent(FAILED_LEAD);
    expect(rowFor(2)).toHaveTextContent(VERDICT_LABEL.needs_review);
    expect(rowFor(2)).toHaveTextContent(REVIEW_LEAD);
  });

  it("says what went wrong in the call's own words, not the verdict's generic line, in one line with the whole lead on hover", async () => {
    fakeServer([done([failedRow(1), passedRow(2)])]);
    renderList();
    await findRow("call_1");
    expect(FAILED_LEAD).not.toBe(FAILED_LINE);
    expect(rowFor(1)).not.toHaveTextContent(FAILED_LINE);
    const lead = within(rowFor(1)).getByText(FAILED_LEAD);
    expect(lead).toHaveAttribute("title", FAILED_LEAD);
    expect(lead.className).toContain("truncate");
    // A passed call says only whether there were promises to check, in quiet type.
    const quiet = within(rowFor(2)).getByText(LIST_WORDS.everyPromiseKept);
    expect(quiet.className).toContain("truncate");
    expect(quiet.className).toContain("text-report-muted");
  });

  it("falls back to the headline for a report that has no lead", async () => {
    fakeServer([done([row(1, { state: "report", verdict: "failed", headline: FAILED_LINE })])]);
    renderList();
    await findRow("call_1");
    expect(rowFor(1)).toHaveTextContent(FAILED_LINE);
  });

  it("encodes an odd call id in the link", async () => {
    fakeServer([done([row(1, { callId: "call a/b", state: "report", verdict: "passed", headline: PASSED_LINE })])]);
    renderList();
    await findRow("call a/b");
    expect(rowOf("call a/b").querySelector("a")).toHaveAttribute("href", "/reports/call%20a%2Fb");
  });

  it("says why in place for a call with no transcript, and does not link it", async () => {
    fakeServer([done([noContentRow(1)])]);
    renderList();
    await findRow("call_1");
    expect(rowFor(1)).toHaveTextContent("Retell kept no transcript for this call.");
    expect(within(rowFor(1)).getByText(RESULT_LABEL.not_run)).toBeInTheDocument();
    expect(rowFor(1).querySelector("a")).toBeNull();
  });

  it("says Overhear could not check a call, and does not link it", async () => {
    fakeServer([done([errorRow(1)])]);
    renderList();
    await findRow("call_1");
    expect(rowFor(1)).toHaveTextContent("Overhear couldn’t check this call.");
    expect(rowFor(1).querySelector("a")).toBeNull();
  });

  it("shows Couldn’t load on a failed row, and Retry fetches that call again", async () => {
    const server = fakeServer([done([errorRow(1)]), done([passedRow(1)])]);
    renderList();
    await findRow("call_1");
    expect(within(rowFor(1)).getByText(LIST_WORDS.couldntLoad)).toBeInTheDocument();
    fireEvent.click(within(rowFor(1)).getByRole("button", { name: LIST_WORDS.retry }));
    await waitFor(() => expect(server.count("POST", "/api/calls/call_1/refetch")).toBe(1));
    await waitFor(() => expect(within(rowFor(1)).getByText(VERDICT_LABEL.passed)).toBeInTheDocument());
    expect(rowFor(1).querySelector("a")).toHaveAttribute("href", "/reports/call_1");
  });

  it("says a retry failed when the call is still an error afterwards", async () => {
    const server = fakeServer([done([errorRow(1)])]);
    renderList();
    await findRow("call_1");
    fireEvent.click(within(rowFor(1)).getByRole("button", { name: LIST_WORDS.retry }));
    await waitFor(() => expect(server.count("POST", "/api/calls/call_1/refetch")).toBe(1));
    await waitFor(() => expect(rowFor(1)).toHaveTextContent(LIST_WORDS.stillCouldnt));
    expect(within(rowFor(1)).getByRole("button", { name: LIST_WORDS.retry })).toBeEnabled();
  });

  it("says a call with an unknown length has none", async () => {
    fakeServer([done([row(1, { durationMs: null, state: "report", verdict: "passed", headline: PASSED_LINE })])]);
    renderList();
    await findRow("call_1");
    expect(rowFor(1)).toHaveTextContent(LIST_WORDS.unknownLength);
  });

  it("says how many calls that had not ended were left out", async () => {
    fakeServer([done([passedRow(1)], { skipped: 2 })]);
    renderList();
    await findRow("call_1");
    expect(screen.getByText(LIST_WORDS.skipped(2))).toBeInTheDocument();
  });

  it("says an account with no calls has none, and offers to check again", async () => {
    const server = fakeServer([done([], { listed: 0 })]);
    renderList();
    await waitFor(() => expect(h1()).toHaveTextContent("No calls yet in this Retell account."));
    expect(screen.queryByLabelText(LIST_WORDS.summaryLabel)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.checkAgain }));
    await waitFor(() => expect(server.count("POST", "/api/pulls")).toBe(2));
  });

  it("says so when every call listed is still in progress", async () => {
    fakeServer([done([], { listed: 3, skipped: 3 })]);
    renderList();
    await waitFor(() => expect(h1()).toHaveTextContent(LIST_WORDS.noFinished));
    expect(screen.getByText(LIST_WORDS.skipped(3))).toBeInTheDocument();
  });
});

describe("choosing how many to check", () => {
  it("offers 25, 50 and 100, with the current one pressed, and starts a new pull of the one chosen", async () => {
    // The server holds every poll after the click until the test lets go, so the "finding" state is on screen when
    // it is asserted. Without the hold, a pull that finishes at once could skip past it.
    const finished = done([passedRow(1)]);
    let hold: Promise<void> | null = null;
    let release: () => void = () => {};
    const server = fakeServer([finished], {
      "GET /api/pulls/pull_1": async () => {
        if (hold) await hold;
        return new Response(JSON.stringify(finished), { status: 200 });
      },
    });
    renderList();
    await findRow("call_1");
    const group = screen.getByRole("group", { name: LIST_WORDS.choiceLabel });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual(["25", "50", "100"]);
    expect(within(group).getByRole("button", { name: "25" })).toHaveAttribute("aria-pressed", "true");
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    fireEvent.click(within(group).getByRole("button", { name: "100" }));
    await waitFor(() => expect(server.count("POST", "/api/pulls")).toBe(2));
    expect(server.calls.filter((c) => c.url === "/api/pulls").map((c) => c.body)).toEqual([{ n: 25 }, { n: 100 }]);
    await waitFor(() => expect(h1()).toHaveTextContent("Finding your last 100 calls"));
    release();
    await waitFor(() => expect(h1()).not.toHaveTextContent("Finding your last 100 calls"));
    await findRow("call_1");
  });

  it("cannot be changed while calls are being checked", async () => {
    fakeServer([progress([row(1)])]);
    renderList();
    await findRow("call_1");
    for (const button of within(screen.getByRole("group", { name: LIST_WORDS.choiceLabel })).getAllByRole("button")) expect(button).toBeDisabled();
  });
});

describe("when the pull cannot go on", () => {
  it("goes back to the connect screen, with Retell’s refusal, when the key stops working mid-pull", async () => {
    const server = fakeServer([progress([passedRow(1), row(2)]), progress([passedRow(1), errorRow(2)], { phase: "failed", error: { code: "bad_key", message: PULL_ERROR_MESSAGE.bad_key } })]);
    renderList();
    await findRow("call_1");
    expect(onDisconnected).not.toHaveBeenCalled();
    server.next();
    await waitFor(() => expect(onDisconnected).toHaveBeenCalledWith("bad_key"));
  });

  it("goes back to the connect screen when the server answers 401", async () => {
    fakeServer([], { "GET /api/pulls/pull_1": () => new Response("{}", { status: 401 }) });
    renderList();
    await waitFor(() => expect(onDisconnected).toHaveBeenCalledWith("bad_key"));
  });

  it("goes back to the connect screen, without a notice, when no key is saved any more", async () => {
    fakeServer([], { "POST /api/pulls": () => new Response(JSON.stringify({ error: "not_connected" }), { status: 409 }) });
    renderList();
    await waitFor(() => expect(onDisconnected).toHaveBeenCalledWith(undefined));
  });

  it("says what stopped a pull that listed nothing, and offers to try again", async () => {
    const server = fakeServer([progress([], { phase: "failed", listed: null, error: { code: "rate_limited", message: PULL_ERROR_MESSAGE.rate_limited } })]);
    renderList();
    await waitFor(() => expect(h1()).toHaveTextContent(LIST_WORDS.couldntList));
    expect(screen.getByText(PULL_ERROR_MESSAGE.rate_limited)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.tryAgain }));
    await waitFor(() => expect(server.count("POST", "/api/pulls")).toBe(2));
  });

  it("keeps the finished rows when a pull fails part way for a reason other than the key", async () => {
    fakeServer([progress([failedRow(1), row(2)], { phase: "failed", error: { code: "network", message: PULL_ERROR_MESSAGE.network } })]);
    renderList();
    await waitFor(() => expect(h1()).toHaveTextContent(LIST_WORDS.couldntFinish));
    expect(screen.getByText(PULL_ERROR_MESSAGE.network)).toBeInTheDocument();
    expect(within(rowFor(1)).getByText(VERDICT_LABEL.failed)).toBeInTheDocument();
    expect(within(rowFor(2)).getByText(RESULT_LABEL.not_run)).toBeInTheDocument();
  });

  it("says Overhear itself cannot be reached when the pull cannot be started", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    renderList();
    await waitFor(() => expect(h1()).toHaveTextContent(LIST_WORDS.couldntStart));
    expect(screen.getByRole("button", { name: LIST_WORDS.tryAgain })).toBeEnabled();
  });

  it("keeps trying when a poll fails, and says so", async () => {
    let polls = 0;
    fakeServer([], {
      "GET /api/pulls/pull_1": async () => {
        polls++;
        if (polls === 1) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify(progress([passedRow(1)])), { status: 200 });
      },
    });
    renderList();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(CONNECT_WORDS.serverDown));
    await findRow("call_1");
    expect(screen.getByRole("status")).not.toHaveTextContent(CONNECT_WORDS.serverDown);
  });
});

describe("the connection bar", () => {
  it("says Retell is connected and where the key is saved", async () => {
    fakeServer([done([passedRow(1)])]);
    renderList();
    const bar = await screen.findByRole("banner");
    expect(bar).toHaveTextContent(LIST_WORDS.connected);
    expect(bar).toHaveTextContent(LOCATION);
    expect(within(bar).getByRole("button", { name: LIST_WORDS.disconnect })).toBeEnabled();
  });

  it("Disconnect calls DELETE /api/connect and hands back to the connect screen", async () => {
    const server = fakeServer([done([passedRow(1)])]);
    renderList();
    await findRow("call_1");
    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.disconnect }));
    await waitFor(() => expect(onDisconnected).toHaveBeenCalledWith(undefined));
    expect(server.count("DELETE", "/api/connect")).toBe(1);
  });

  it("stops a running pull before it removes the key", async () => {
    const server = fakeServer([progress([row(1)])]);
    renderList();
    await findRow("call_1");
    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.disconnect }));
    await waitFor(() => expect(onDisconnected).toHaveBeenCalled());
    const order = server.calls.map((c) => `${c.method} ${c.url}`);
    expect(order.indexOf("POST /api/pulls/pull_1/cancel")).toBeGreaterThan(-1);
    expect(order.indexOf("POST /api/pulls/pull_1/cancel")).toBeLessThan(order.indexOf("DELETE /api/connect"));
  });

  it("says the key could not be removed, and stays on the list", async () => {
    fakeServer([done([passedRow(1)])], { "DELETE /api/connect": () => new Response(JSON.stringify({ connected: false, error: "store_failed" }), { status: 500 }) });
    renderList();
    await findRow("call_1");
    fireEvent.click(screen.getByRole("button", { name: LIST_WORDS.disconnect }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(LIST_WORDS.disconnectFailed));
    expect(onDisconnected).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: LIST_WORDS.disconnect })).toBeEnabled();
  });
});

describe("the words", () => {
  it("has no em dash, en dash or straight quote in any string it says", () => {
    const leaves = Object.values(LIST_WORDS).flatMap((v) => (typeof v === "object" ? Object.values(v) : [v]));
    const strings = leaves.flatMap((v) => (typeof v === "function" ? [v(1 as never, 1 as never), v(2 as never, 2 as never)].map(String) : [v]));
    for (const s of strings) expect(s, s).not.toMatch(/[\u2013\u2014"']/);
  });

  it("never prints the call times in the browser’s own language when a zone is given", async () => {
    fakeServer([done([passedRow(0)])]);
    renderList({ timeZone: "America/New_York" });
    await findRow("call_0");
    expect(rowFor(0)).toHaveTextContent("Nov 6, 10:42");
  });
});

// ---------- OVE-68: the shell, the filters, quieter Passed rows ----------

const withNotes = (r: PullRow, notes: NonNullable<PullRow["notes"]>): PullRow => ({ ...r, notes });
const mixed = () => [passedRow(1), failedRow(2), nothingDoneRow(3), reviewRow(4), passedRow(5), nothingDoneRow(6)];
const filterLink = (name: RegExp | string) => screen.getByRole("link", { name });
const FILTER_CASES = [
  ["failed", VERDICT_LABEL.failed, ["call_2"]],
  ["needs_review", VERDICT_LABEL.needs_review, ["call_4"]],
  ["passed", VERDICT_LABEL.passed, ["call_1", "call_5"]],
  ["nothing_done", VERDICT_LABEL.nothing_done, ["call_3", "call_6"]],
] as const;

describe("the shell", () => {
  it("puts the product name, the two main links and the connection in one header, with Calls as the current page", async () => {
    fakeServer([done([passedRow(1)])]);
    renderList();
    await findRow("call_1");
    expect(screen.getByRole("link", { name: "Overhear" })).toHaveAttribute("href", "/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    const calls = within(nav).getByRole("link", { name: "Calls" });
    expect(calls).toHaveAttribute("href", "/");
    expect(calls).toHaveAttribute("aria-current", "page");
    expect(calls).toHaveClass("text-report-accent", "min-h-11");
    const test = within(nav).getByRole("link", { name: "Test call" });
    expect(test).toHaveAttribute("href", "/test-call");
    expect(test).not.toHaveAttribute("aria-current");
    expect(test).toHaveClass("text-report-ink-2", "min-h-11");
    expect(screen.getByRole("button", { name: LIST_WORDS.disconnect })).toBeInTheDocument();
  });

  it("shows the key path only from the sm breakpoint up, so a phone never breaks it mid-word", async () => {
    fakeServer([done([passedRow(1)])]);
    renderList();
    await findRow("call_1");
    const path = screen.getByText(LOCATION);
    expect(path.parentElement).toHaveClass("hidden", "sm:inline");
    expect(screen.getByText(LIST_WORDS.connected, { exact: false })).toBeInTheDocument();
  });

  it("no longer has a Test call button among the list's controls", async () => {
    fakeServer([done([passedRow(1)])]);
    renderList();
    await findRow("call_1");
    expect(screen.getAllByRole("link", { name: "Test call" })).toHaveLength(1);
  });
});

describe("the status filters", () => {
  it("show All and the four verdicts with their counts, a zero still there and muted", async () => {
    fakeServer([done([failedRow(1), passedRow(2), passedRow(3)])]);
    renderList();
    await findRow("call_1");
    expect(filterLink("All 3")).toHaveAttribute("href", "/");
    expect(filterLink(`${VERDICT_LABEL.failed} 1`)).toHaveClass("text-report-critical");
    expect(filterLink(`${VERDICT_LABEL.passed} 2`)).toHaveClass("text-report-ink-2");
    const zero = filterLink(`${VERDICT_LABEL.needs_review} 0`);
    expect(zero).toHaveClass("text-report-muted");
    expect(zero).toHaveAttribute("href", "/?show=needs_review");
    expect(filterLink(`${VERDICT_LABEL.nothing_done} 0`)).toHaveClass("text-report-muted");
    expect(filterLink(/^All/)).toHaveClass("min-h-11");
  });

  it("mark All as the current one with no filter in the address, underlined in the accent color", async () => {
    fakeServer([done(mixed())]);
    renderList();
    await findRow("call_1");
    const all = filterLink(/^All/);
    expect(all).toHaveAttribute("aria-current", "true");
    expect(all.firstElementChild).toHaveClass("underline", "decoration-2", "decoration-report-accent", "underline-offset-4");
    expect(filterLink(new RegExp(`^${VERDICT_LABEL.failed}`))).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { level: 2, name: LIST_WORDS.attentionHeading })).toBeInTheDocument();
  });

  it.each(FILTER_CASES)("%s keeps only its calls in one flat list with no group headings", async (show, word, ids) => {
    visit(`/?show=${show}`);
    fakeServer([done(mixed())]);
    renderList();
    await findRow(ids[0]);
    expect(idsInOrder()).toEqual([...ids]);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.getByRole("list", { name: word })).toBeInTheDocument();
    expect(filterLink(new RegExp(`^${word}`))).toHaveAttribute("aria-current", "true");
    expect(filterLink(/^All/)).not.toHaveAttribute("aria-current");
  });

  it("follows the order the groups give, so the failed call sits above needs review under All", async () => {
    fakeServer([done(mixed())]);
    renderList();
    await findRow("call_1");
    expect(idsInOrder()).toEqual(["call_2", "call_4", "call_1", "call_5", "call_3", "call_6"]);
  });

  it("changes the address in place with router.replace, keeps the pull, and does not fetch again", async () => {
    const server = fakeServer([done(mixed())]);
    renderList();
    await findRow("call_1");
    const polls = server.count("GET", "/api/pulls/pull_1");
    const starts = server.count("POST", "/api/pulls");
    fireEvent.click(filterLink(new RegExp(`^${VERDICT_LABEL.failed}`)));
    expect(router.replace).toHaveBeenCalledWith("/?show=failed", { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
    await waitFor(() => expect(idsInOrder()).toEqual(["call_2"]));
    expect(currentHref()).toBe("/?show=failed");
    expect(window.sessionStorage.getItem("overhear.pull")).toBe("pull_1");
    expect(server.count("GET", "/api/pulls/pull_1")).toBe(polls);
    expect(server.count("POST", "/api/pulls")).toBe(starts);
    fireEvent.click(filterLink(/^All/));
    expect(router.replace).toHaveBeenLastCalledWith("/", { scroll: false });
    await waitFor(() => expect(idsInOrder()).toHaveLength(6));
  });

  it("carries the filter to each row's report link, and none under All", async () => {
    visit("/?show=passed");
    fakeServer([done(mixed())]);
    renderList();
    await findRow("call_1");
    expect(rowFor(1).querySelector("a")).toHaveAttribute("href", "/reports/call_1?from=passed");
    fireEvent.click(filterLink(/^All/));
    await waitFor(() => expect(rowFor(2).querySelector("a")).toHaveAttribute("href", "/reports/call_2"));
  });

  it("ignores a filter it does not know and shows All", async () => {
    visit("/?show=bogus");
    fakeServer([done(mixed())]);
    renderList();
    await findRow("call_1");
    expect(idsInOrder()).toHaveLength(6);
    expect(filterLink(/^All/)).toHaveAttribute("aria-current", "true");
  });

  it("leaves calls that could not be checked or have no transcript to All only", async () => {
    visit("/?show=failed");
    fakeServer([done([failedRow(1), errorRow(2), noContentRow(3)])]);
    renderList();
    await findRow("call_1");
    expect(idsInOrder()).toEqual(["call_1"]);
    fireEvent.click(filterLink(/^All/));
    await waitFor(() => expect(idsInOrder()).toEqual(["call_1", "call_2", "call_3"]));
  });

  it.each([
    ["failed", "No failed calls in the last 25."],
    ["needs_review", "No calls that need review in the last 25."],
    ["passed", "No passed calls in the last 25."],
    ["nothing_done", "No calls with nothing done in the last 25."],
  ] as const)("with no %s calls says so and offers Show all calls", async (show, title) => {
    visit(`/?show=${show}`);
    const others = [failedRow(1), reviewRow(2), passedRow(3), nothingDoneRow(4)].filter((r) => r.verdict !== show);
    fakeServer([done(others)]);
    renderList();
    expect(await screen.findByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    expect(idsInOrder()).toEqual([]);
    fireEvent.click(screen.getByRole("link", { name: LIST_WORDS.showAll }));
    expect(router.replace).toHaveBeenCalledWith("/", { scroll: false });
    await waitFor(() => expect(idsInOrder()).toHaveLength(3));
    expect(screen.queryByText(title)).toBeNull();
  });

  it("says the count the pull checked, not always 25", async () => {
    visit("/?show=failed");
    fakeServer([done([passedRow(1)], { requested: 50 })]);
    renderList();
    expect(await screen.findByText("No failed calls in the last 50.")).toBeInTheDocument();
  });

  it("does not say there are none while calls are still being checked", async () => {
    visit("/?show=failed");
    fakeServer([progress([passedRow(1), row(2)])]);
    renderList();
    await findRow("call_1").catch(() => null);
    await waitFor(() => expect(h1()).toHaveTextContent("Checked 1 of 2 calls"));
    expect(screen.queryByText(/No failed calls/)).toBeNull();
  });

  it("holds a long list of 100 calls under a filter, in order", async () => {
    visit("/?show=passed");
    const rows = Array.from({ length: 100 }, (_, i) => (i % 10 === 0 ? failedRow(i + 1) : passedRow(i + 1)));
    fakeServer([done(rows, { requested: 100 })]);
    renderList();
    await findRow("call_2");
    expect(idsInOrder()).toHaveLength(90);
    expect(idsInOrder()[0]).toBe("call_2");
    expect(filterLink(`${VERDICT_LABEL.passed} 90`)).toBeInTheDocument();
  });

  it("keeps the loading and no-calls states as they were with a filter in the address", async () => {
    visit("/?show=failed");
    fakeServer([progress([], { phase: "listing", listed: null })]);
    renderList();
    expect(h1()).toHaveTextContent("Finding your last 25 calls");
    cleanup();
    fakeServer([done([])]);
    renderList();
    await waitFor(() => expect(h1()).toHaveTextContent(LIST_WORDS.noCalls));
    expect(screen.queryByText(/No failed calls/)).toBeNull();
  });

  it("keeps the error state as it was with a filter in the address", async () => {
    visit("/?show=failed");
    fakeServer([done([])], { "POST /api/pulls": () => new Response("{}", { status: 500 }) });
    renderList();
    await waitFor(() => expect(h1()).toHaveTextContent(LIST_WORDS.couldntStart));
    expect(screen.queryByText(/No failed calls/)).toBeNull();
  });
});

describe("a Passed row", () => {
  it("says only that every promise was kept when it made promises", async () => {
    fakeServer([done([passedRow(1)])]);
    renderList();
    await findRow("call_1");
    expect(rowFor(1)).toHaveTextContent(LIST_WORDS.everyPromiseKept);
    expect(rowFor(1)).not.toHaveTextContent(PASSED_LINE);
    expect(LIST_WORDS.everyPromiseKept).toBe("Every promise was kept.");
  });

  it("says there were no promises to check when the report notes that", async () => {
    fakeServer([done([withNotes(passedRow(1), ["no_promises_made"])])]);
    renderList();
    await findRow("call_1");
    expect(rowFor(1)).toHaveTextContent("No promises to check.");
  });

  it("keeps the Call experience line under it", async () => {
    fakeServer([done([passedRow(1, 2)])]);
    renderList();
    await findRow("call_1");
    expect(rowFor(1)).toHaveTextContent("Every promise was kept.");
    expect(rowFor(1)).toHaveTextContent("Call experience: 2 problems");
  });

  it("drops the caller's-request sentence from rows and says it once under the list when a row has the note", async () => {
    fakeServer([done([withNotes(passedRow(1), ["request_not_checked"]), withNotes(passedRow(2), ["no_promises_made", "request_not_checked"])])]);
    renderList();
    await findRow("call_1");
    expect(rowFor(1)).not.toHaveTextContent(/request/);
    expect(rowFor(2)).not.toHaveTextContent(/request/);
    expect(screen.getAllByText("Overhear doesn’t check the caller’s request yet.")).toHaveLength(1);
  });

  it("does not say it when no row has the note", async () => {
    fakeServer([done([passedRow(1), failedRow(2)])]);
    renderList();
    await findRow("call_1");
    expect(screen.queryByText(/check the caller/)).toBeNull();
  });

  it("keeps its words free of dashes and straight apostrophes", () => {
    for (const text of [LIST_WORDS.noPromises, LIST_WORDS.everyPromiseKept, LIST_WORDS.requestNotChecked, LIST_WORDS.showAll]) expect(text).not.toMatch(/[–—'-]/);
  });
});
