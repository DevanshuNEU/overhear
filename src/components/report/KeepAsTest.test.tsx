import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PIN_MESSAGE } from "@/pull/labels";
import { CONTRACT_TITLE, EXPERIENCE_TITLE, RESULT_LABEL, VERDICT_LABEL, capitalize } from "@/report/labels";
import { failedSample, passedSample } from "@/report/samples";
import { KeepAsTest } from "./KeepAsTest";
import { keepItemsOf, pinBody, startTicks } from "./keepModel";
import { PIN_NOTE_MAX } from "@/engine/eval/case";
import { KEEP_NOTE_MAX, KEEP_WORDS } from "@/report/labels";
import { CallReportView } from "./CallReportView";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Call = { method: string; url: string; body: unknown };

/** A fake local server for the pin routes. `pins` is what GET /api/pins lists; the others answer POST and DELETE. */
function fakeServer(opts: { pins?: { id: string; callId: string }[]; post?: () => Response; del?: () => Response } = {}) {
  const calls: Call[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    if (method === "GET" && url === "/api/pins") return json({ pins: opts.pins ?? [], problems: [] });
    if (method === "POST" && url === "/api/pins") return opts.post ? opts.post() : json({ id: "pin-call-1-abcd1234", status: "pinned" });
    if (method === "DELETE" && url.startsWith("/api/pins/")) return opts.del ? opts.del() : json({ deleted: 1 });
    throw new Error(`unexpected ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, posted: () => calls.filter((c) => c.method === "POST") };
}

const open = () => fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.open }));
const box = (title: string) => screen.getByRole("checkbox", { name: new RegExp(`^${title}`, "i") }) as HTMLInputElement;

it("limits a note to what the pin route takes", () => {
  expect(KEEP_NOTE_MAX).toBe(PIN_NOTE_MAX);
});

describe("keepItemsOf", () => {
  it("ticks broken and unchecked rules, lists held and not applicable rules unticked, and leaves out rules that did not run", () => {
    const items = keepItemsOf(failedSample);
    expect(items.verdict).toBe("failed");
    const byId = Object.fromEntries(items.contracts.map((c) => [c.id, c]));
    expect(byId.transfer_kept).toMatchObject({ result: "violated", ticked: true });
    expect(byId.promise_backed).toMatchObject({ result: "passed", ticked: false });
    expect(byId.committed_matches_request).toBeUndefined();
  });

  it("ticks every experience problem and lists a check that found nothing unticked", () => {
    const items = keepItemsOf(passedSample);
    const byId = Object.fromEntries(items.experience.map((c) => [c.id, c]));
    expect(byId.agent_ends_call).toMatchObject({ result: "problem", ticked: true });
    expect(byId.spoken_format).toMatchObject({ result: "problem", ticked: true });
    expect(byId.error_handled).toMatchObject({ result: "clean", ticked: false });
    expect(items.contracts.find((c) => c.id === "transfer_kept")).toMatchObject({ result: "not_applicable", ticked: false });
  });

  it("builds the body from the ticks, with what was shown, and leaves out an empty note", () => {
    const items = keepItemsOf(passedSample);
    const body = pinBody(passedSample.callId, items, startTicks(items), "   ");
    expect(body).toEqual({
      callId: passedSample.callId,
      keep: { contracts: [], experience: ["agent_ends_call", "spoken_format"] },
      saw: {
        verdict: "passed",
        contracts: { promise_backed: "passed", verified_before_change: "passed", spoken_matches_committed: "passed", transfer_kept: "not_applicable" },
        experience: { agent_ends_call: "problem", error_handled: "clean", spoken_format: "problem" },
      },
    });
  });
});

describe("KeepAsTest", () => {
  it("starts closed, with one button", async () => {
    fakeServer();
    render(<KeepAsTest report={failedSample} />);
    expect(screen.getByRole("button", { name: KEEP_WORDS.open })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: KEEP_WORDS.open })).toBeEnabled());
  });

  it("opens to the verdict as always kept, the broken rule ticked and the held rules not", () => {
    fakeServer();
    render(<KeepAsTest report={failedSample} />);
    open();
    expect(screen.getByText(VERDICT_LABEL.failed)).toBeInTheDocument();
    expect(screen.getByText(KEEP_WORDS.alwaysKept)).toBeInTheDocument();
    expect(box(capitalize(CONTRACT_TITLE.transfer_kept)).checked).toBe(true);
    expect(box(capitalize(CONTRACT_TITLE.promise_backed)).checked).toBe(false);
    expect(box(capitalize(CONTRACT_TITLE.spoken_matches_committed)).checked).toBe(false);
    const row = screen.getByRole("checkbox", { name: new RegExp(capitalize(CONTRACT_TITLE.transfer_kept), "i") }).closest("li")!;
    expect(within(row).getByText(RESULT_LABEL.violated)).toBeInTheDocument();
  });

  it("starts every experience problem ticked and a clean check not", () => {
    fakeServer();
    render(<KeepAsTest report={passedSample} />);
    open();
    expect(box(capitalize(EXPERIENCE_TITLE.agent_ends_call)).checked).toBe(true);
    expect(box(capitalize(EXPERIENCE_TITLE.spoken_format)).checked).toBe(true);
    expect(box(capitalize(EXPERIENCE_TITLE.error_handled)).checked).toBe(false);
  });

  it("sends what is ticked, the note, and what the screen showed", async () => {
    const server = fakeServer();
    render(<KeepAsTest report={failedSample} />);
    open();
    fireEvent.click(box(capitalize(CONTRACT_TITLE.promise_backed)));
    fireEvent.change(screen.getByLabelText(KEEP_WORDS.noteLabel), { target: { value: "nurse transfer promised, never made" } });
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.keep }));
    await screen.findByText(KEEP_WORDS.kept);
    expect(server.posted()).toHaveLength(1);
    expect(server.posted()[0].body).toEqual({
      callId: failedSample.callId,
      keep: { contracts: ["promise_backed", "transfer_kept"], experience: [] },
      note: "nurse transfer promised, never made",
      saw: {
        verdict: "failed",
        contracts: { promise_backed: "passed", verified_before_change: "passed", spoken_matches_committed: "passed", transfer_kept: "violated" },
        experience: { agent_ends_call: "clean", error_handled: "clean", spoken_format: "clean" },
      },
    });
  });

  it("keeps a note to one line of at most 280 characters", () => {
    fakeServer();
    render(<KeepAsTest report={failedSample} />);
    open();
    const note = screen.getByLabelText(KEEP_WORDS.noteLabel) as HTMLInputElement;
    expect(note.tagName).toBe("INPUT");
    expect(note).toHaveAttribute("maxlength", "280");
  });

  it("shows the first-pin warning when nothing is pinned yet, and not when something is", async () => {
    fakeServer({ pins: [] });
    const { unmount } = render(<KeepAsTest report={failedSample} />);
    open();
    expect(await screen.findByText(KEEP_WORDS.firstPin)).toBeInTheDocument();
    unmount();
    fakeServer({ pins: [{ id: "pin-other-12345678", callId: "call_other" }] });
    render(<KeepAsTest report={failedSample} />);
    open();
    await waitFor(() => expect(screen.queryByText(KEEP_WORDS.firstPin)).toBeNull());
  });

  it("shows the warning while it does not yet know whether anything is pinned", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    render(<KeepAsTest report={failedSample} />);
    open();
    expect(screen.getByText(KEEP_WORDS.firstPin)).toBeInTheDocument();
  });

  it("reads Kept as a test with Remove after a keep, and Remove deletes that pin", async () => {
    const server = fakeServer();
    render(<KeepAsTest report={failedSample} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.keep }));
    await screen.findByText(KEEP_WORDS.kept);
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.remove }));
    await waitFor(() => expect(screen.getByRole("button", { name: KEEP_WORDS.open })).toBeInTheDocument());
    expect(server.calls.at(-1)).toMatchObject({ method: "DELETE", url: "/api/pins/pin-call-1-abcd1234" });
    expect(screen.queryByText(KEEP_WORDS.kept)).toBeNull();
  });

  it("reads Kept as a test at once for a call that is already pinned", async () => {
    const server = fakeServer({ pins: [{ id: "pin-call-sample-failed-1234abcd", callId: failedSample.callId }] });
    render(<KeepAsTest report={failedSample} />);
    expect(await screen.findByText(KEEP_WORDS.kept)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.remove }));
    await waitFor(() => expect(server.calls.at(-1)).toMatchObject({ method: "DELETE", url: "/api/pins/pin-call-sample-failed-1234abcd" }));
  });

  it("shows the message for a call that reads differently now, with a way to reload it", async () => {
    fakeServer({ post: () => new Response(JSON.stringify({ error: "changed", message: PIN_MESSAGE.changed }), { status: 409 }) });
    render(<KeepAsTest report={failedSample} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.keep }));
    expect(await screen.findByRole("alert")).toHaveTextContent(PIN_MESSAGE.changed);
    const reload = screen.getByRole("link", { name: KEEP_WORDS.reload });
    expect(reload).toHaveAttribute("href", `/reports/${failedSample.callId}`);
    expect(screen.getByRole("button", { name: KEEP_WORDS.keep })).toBeEnabled();
  });

  it("shows another refusal as the server worded it, with no reload link", async () => {
    fakeServer({ post: () => new Response(JSON.stringify({ error: "too_many", message: PIN_MESSAGE.too_many }), { status: 409 }) });
    render(<KeepAsTest report={failedSample} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.keep }));
    expect(await screen.findByRole("alert")).toHaveTextContent(PIN_MESSAGE.too_many);
    expect(screen.queryByRole("link", { name: KEEP_WORDS.reload })).toBeNull();
  });

  it("says Overhear did not answer when the request cannot be made", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ pins: [], problems: [] }));
        throw new TypeError("network");
      }),
    );
    render(<KeepAsTest report={failedSample} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.keep }));
    expect(await screen.findByRole("alert")).toHaveTextContent(KEEP_WORDS.unreachable);
  });

  it("closes again on Cancel without sending anything", () => {
    const server = fakeServer();
    render(<KeepAsTest report={failedSample} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.cancel }));
    expect(screen.getByRole("button", { name: KEEP_WORDS.open })).toBeInTheDocument();
    expect(server.posted()).toHaveLength(0);
  });
});

describe("the call report view", () => {
  it("has no Keep as a test unless it is asked for, so the hosted demo never shows it", () => {
    fakeServer();
    render(<CallReportView report={failedSample} />);
    expect(screen.queryByRole("button", { name: KEEP_WORDS.open })).toBeNull();
  });

  const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it("shows one quiet action in the header row beside the verdict, and no panel until it is clicked", () => {
    fakeServer();
    render(<CallReportView report={failedSample} keep />);
    const button = screen.getByRole("button", { name: KEEP_WORDS.open });
    const row = screen.getByText(VERDICT_LABEL.failed).closest("div")!;
    expect(row).toContainElement(button);
    expect(screen.queryByRole("region", { name: KEEP_WORDS.heading })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    // The sentence that answers the page follows the row at once: nothing sits between the verdict and it.
    expect(row.nextElementSibling).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it("opens the panel under the facts, so the verdict and its sentence stay where they were", () => {
    fakeServer();
    render(<CallReportView report={failedSample} keep />);
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.open }));
    const panel = screen.getByRole("region", { name: KEEP_WORDS.heading });
    expect(follows(screen.getByRole("list", { name: "Key facts" }), panel)).toBe(true);
    expect(follows(screen.getByRole("heading", { level: 1 }), panel)).toBe(true);
    // While the panel is open the row's action is gone: the panel has its own Keep and Cancel.
    expect(screen.getAllByRole("button", { name: KEEP_WORDS.keep })).toHaveLength(1);
  });

  it("reads Kept as a test with Remove in the same row after a keep, and says where it was saved", async () => {
    fakeServer();
    render(<CallReportView report={failedSample} keep />);
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.open }));
    fireEvent.click(screen.getByRole("button", { name: KEEP_WORDS.keep }));
    const kept = await screen.findByText(KEEP_WORDS.kept);
    const row = screen.getByText(VERDICT_LABEL.failed).closest("div")!;
    expect(row).toContainElement(kept);
    expect(row).toContainElement(screen.getByRole("button", { name: KEEP_WORDS.remove }));
    expect(screen.getByText(KEEP_WORDS.keptWhere)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: KEEP_WORDS.heading })).toBeNull();
  });

  it("does not repeat where it was saved for a call that was already kept when the page loaded", async () => {
    fakeServer({ pins: [{ id: "pin-call-sample-failed-1234abcd", callId: failedSample.callId }] });
    render(<CallReportView report={failedSample} keep />);
    expect(await screen.findByText(KEEP_WORDS.kept)).toBeInTheDocument();
    expect(screen.queryByText(KEEP_WORDS.keptWhere)).toBeNull();
  });
});
