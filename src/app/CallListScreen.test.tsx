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

describe("the test call link", () => {
  it("sits beside Check again and opens the test call screen, while calls are checked and after", async () => {
    fakeServer([progress([failedRow(1)]), done([failedRow(1)])]);
    renderList();
    const link = await screen.findByRole("link", { name: LIST_WORDS.testCall });
    expect(link).toHaveAttribute("href", "/test-call");
    await waitFor(() => expect(screen.getByRole("button", { name: LIST_WORDS.stop })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: LIST_WORDS.testCall })).toBeInTheDocument();
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
    expect(rowFor(1)).toHaveTextContent(PASSED_LINE);
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
    expect(screen.getByLabelText(LIST_WORDS.summaryLabel)).toHaveTextContent("12 calls");
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
    expect(summary).toHaveTextContent("6 calls");
    expect(summary).toHaveTextContent(`2 ${VERDICT_LABEL.failed}`);
    expect(summary).toHaveTextContent(`1 ${VERDICT_LABEL.needs_review}`);
    expect(summary).toHaveTextContent(`3 ${VERDICT_LABEL.passed}`);
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
    expect(summary).toHaveTextContent(`2 ${VERDICT_LABEL.passed}`);
    expect(summary).toHaveTextContent(`2 ${VERDICT_LABEL.nothing_done}`);
    expect(idsInOrder()).toEqual(["call_2", "call_3", "call_1", "call_4"]);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("shows a Nothing done row as quietly as a passed one, with its headline in muted type, not bold", async () => {
    fakeServer([done([nothingDoneRow(1), failedRow(2)])]);
    renderList();
    const quiet = await findRow("call_1");
    expect(within(quiet).getByText(VERDICT_LABEL.nothing_done)).toBeInTheDocument();
    const line = within(quiet).getByText(NOTHING_DONE_LINE);
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
    // A passed call keeps its short quiet line.
    const quiet = within(rowFor(2)).getByText(PASSED_LINE);
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
    const strings = Object.values(LIST_WORDS).flatMap((v) => (typeof v === "function" ? [v(1 as never, 1 as never), v(2 as never, 2 as never)].map(String) : [v]));
    for (const s of strings) expect(s, s).not.toMatch(/[\u2013\u2014"']/);
  });

  it("never prints the call times in the browser’s own language when a zone is given", async () => {
    fakeServer([done([passedRow(0)])]);
    renderList({ timeZone: "America/New_York" });
    await findRow("call_0");
    expect(rowFor(0)).toHaveTextContent("Nov 6, 10:42");
  });
});
