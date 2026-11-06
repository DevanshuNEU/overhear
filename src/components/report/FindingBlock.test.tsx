import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { FindingBlock } from "./FindingBlock";
import type { Detection, Evidence, Finding } from "@/report/schema";

const evidence: Evidence = {
  callId: "call_x",
  platform: "retell",
  agentVersion: null,
  tier: 2,
  ordering: "sequence",
  callFields: {},
  callStartMs: null,
  gaps: [],
  items: [
    { kind: "turn", seq: 1, role: "caller", text: "Book me with Dr. Lee on Tuesday.", startSec: 3, interrupted: null },
    { kind: "turn", seq: 2, role: "agent", text: "You're booked with Dr. Lee on Tuesday.", startSec: 9.4, interrupted: null },
    { kind: "tool_call", seq: 3, id: "tc_1", name: "book_appointment", args: { slot: "s1" } },
    { kind: "tool_result", seq: 4, id: "tc_1", ok: null, platformOk: null, payload: "timeout" },
    { kind: "backend_action", seq: 5, id: "ae_1", toolCallId: "tc_1", tool: "book_appointment", args: {}, result: { ok: false }, ok: false, ts: "2026-11-05T10:00:00Z", link: { toolCallId: "tc_1", by: "tool_call_id" } },
    { kind: "event", seq: 6, type: "transfer_started", data: { to: "nurse" } },
  ],
};
const detections: Detection[] = [{ seq: 2, cls: "completion", quote: "You're booked", source: "code" }];

const finding: Finding = {
  result: "violated",
  text: "At 0:09 the agent said the booking was done. It was not.",
  said: [2],
  did: [3, 4, 5, 6],
  asked: [1],
  gaps: [],
  fields: [
    { field: "provider", type: "name", from: "requested", values: ["Dr. Lee"], committed: "Dr. Osei", status: "differs" },
    { field: "date", type: "date", from: "spoken", values: ["Tuesday"], committed: null, status: "unresolved" },
  ],
};

describe("FindingBlock", () => {
  const setup = (f: Finding = finding) => render(<FindingBlock finding={f} evidence={evidence} detections={detections} contract="promise_backed" />);

  it("shows the caller's request in the asked lane", () => {
    setup();
    const asked = screen.getByRole("group", { name: "Asked" });
    expect(asked).toHaveTextContent("Book me with Dr. Lee on Tuesday.");
    expect(within(asked).getByText("0:03")).toBeInTheDocument();
  });

  it("describes each kind of thing the system did, one line per action, in order", () => {
    setup();
    const did = screen.getByRole("group", { name: "Did" });
    const lines = within(did).getAllByRole("listitem").map((li) => li.querySelector("[data-line]")?.textContent);
    // A tool call and its result are one line; the backend's record and the event keep a line each.
    expect(lines).toEqual([
      "book_appointment gave no success signal",
      "book_appointment recorded as failed",
      "Event: transfer_started",
    ]);
  });

  it("tags what the backend logged, and nothing else", () => {
    setup();
    expect(screen.getAllByText("Backend log")).toHaveLength(1);
  });

  it("marks differing and unresolved details in words, not only colour", () => {
    setup();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Differs")).toBeInTheDocument();
    expect(within(table).getByText("Couldn't resolve")).toBeInTheDocument();
    // A requested value is labelled as requested, a spoken one as spoken.
    expect(within(table).getByText("Requested: Dr. Lee")).toBeInTheDocument();
    expect(within(table).getByText("Spoken: Tuesday")).toBeInTheDocument();
  });

  it("leaves out the lanes a finding does not use", () => {
    setup({ ...finding, asked: [], said: [], fields: [] });
    expect(screen.queryByRole("group", { name: "Asked" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Said" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows a spoken and a requested check of the same detail, and a detail that was never spoken", () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => void errors.push(a));
    setup({
      ...finding,
      fields: [
        { field: "date", type: "date", from: "spoken", values: ["Tuesday"], committed: "Wednesday", status: "differs" },
        { field: "date", type: "date", from: "requested", values: ["Tuesday"], committed: "Wednesday", status: "differs" },
        { field: "time", type: "time", from: "spoken", values: [], committed: "9:00 AM", status: "not_spoken" },
      ],
    });
    spy.mockRestore();
    expect(errors).toEqual([]);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Spoken: Tuesday")).toBeInTheDocument();
    expect(within(table).getByText("Requested: Tuesday")).toBeInTheDocument();
    expect(within(table).getByText("Nothing spoken")).toBeInTheDocument();
    expect(within(table).getByText("Not spoken")).toBeInTheDocument();
  });

  it("says the value could not be found, not that nothing was committed", () => {
    setup();
    expect(screen.getByText("Couldn't find")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing committed/)).not.toBeInTheDocument();
  });

  it("marks only the quote a finding cites when two claims share a turn", () => {
    const detectionsTwo: Detection[] = [
      { seq: 2, cls: "completion", quote: "You're booked", source: "code" },
      { seq: 2, cls: "completion", quote: "with Dr. Lee on Tuesday", source: "code" },
    ];
    render(
      <FindingBlock
        finding={{ ...finding, fields: [], text: 'At 0:09 the agent said "with Dr. Lee on Tuesday". It was not.' }}
        evidence={evidence}
        detections={detectionsTwo}
        contract="promise_backed"
      />,
    );
    const said = screen.getByRole("group", { name: "Said" });
    expect(Array.from(said.querySelectorAll("mark")).map((m) => m.textContent)).toEqual(["with Dr. Lee on Tuesday"]);
  });

  it("leaves claims unmarked when two share a turn and the finding names neither", () => {
    const detectionsTwo: Detection[] = [
      { seq: 2, cls: "completion", quote: "You're booked", source: "code" },
      { seq: 2, cls: "completion", quote: "with Dr. Lee on Tuesday", source: "code" },
    ];
    render(<FindingBlock finding={{ ...finding, fields: [], text: "The agent made a promise it did not keep." }} evidence={evidence} detections={detectionsTwo} contract="promise_backed" />);
    expect(screen.getByRole("group", { name: "Said" }).querySelectorAll("mark")).toHaveLength(0);
  });

  it("marks the one claim on a turn even when the finding does not quote it", () => {
    render(<FindingBlock finding={{ ...finding, fields: [], text: "The agent made a promise it did not keep." }} evidence={evidence} detections={detections} contract="promise_backed" />);
    expect(Array.from(screen.getByRole("group", { name: "Said" }).querySelectorAll("mark")).map((m) => m.textContent)).toEqual(["You're booked"]);
  });

  it("lets a long detail name wrap in the table", () => {
    const long = "a_very_long_detail_name_".repeat(6);
    render(<FindingBlock finding={{ ...finding, fields: [{ field: long, type: "string", from: "spoken", values: ["x"], committed: "y", status: "differs" }] }} evidence={evidence} detections={detections} contract="promise_backed" />);
    const cell = screen.getByRole("rowheader");
    expect(cell.className).toContain("[overflow-wrap:anywhere]");
  });

  it("marks every quote the finding cites once, merging quotes that overlap", () => {
    render(
      <FindingBlock
        finding={{ ...finding, fields: [], text: `At 0:09 the agent said "You're booked" and "booked with Dr. Lee".` }}
        evidence={evidence}
        detections={[
          { seq: 2, cls: "completion", quote: "You're booked", source: "code" },
          { seq: 2, cls: "completion", quote: "booked with Dr. Lee", source: "code" },
        ]}
        contract="promise_backed"
      />,
    );
    const said = screen.getByRole("group", { name: "Said" });
    expect(Array.from(said.querySelectorAll("mark")).map((m) => m.textContent)).toEqual(["You're booked with Dr. Lee"]);
  });

  it("links to the first item it rests on in the call, and is the target of the timeline's tags", () => {
    render(<FindingBlock finding={finding} evidence={evidence} detections={detections} contract="promise_backed" anchor="finding-promise_backed-0" />);
    expect(screen.getByRole("article")).toHaveAttribute("id", "finding-promise_backed-0");
    expect(screen.getByRole("link", { name: "Show in the call" })).toHaveAttribute("href", "#item-1");
  });

  it("has no link when it cites nothing", () => {
    render(<FindingBlock finding={{ ...finding, asked: [], said: [], did: [] }} evidence={evidence} detections={detections} contract="promise_backed" anchor="finding-x" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("links to the earliest item it cites, wherever it sits in the lists", () => {
    render(<FindingBlock finding={{ ...finding, asked: [6], said: [5], did: [4, 3] }} evidence={evidence} detections={detections} contract="promise_backed" anchor="f" />);
    expect(screen.getByRole("link", { name: "Show in the call" })).toHaveAttribute("href", "#item-3");
  });

  it("describes the link by the finding it belongs to, so a list of links is not N identical names", () => {
    render(<FindingBlock finding={finding} evidence={evidence} detections={detections} contract="promise_backed" anchor="f" />);
    expect(screen.getByRole("link", { name: "Show in the call" })).toHaveAccessibleDescription(finding.text);
  });

  it("hides its sentence from the eye, not from a screen reader, when the lead above already said it", () => {
    render(<FindingBlock finding={finding} evidence={evidence} detections={detections} contract="promise_backed" hideText />);
    expect(screen.getByText(finding.text)).toHaveClass("sr-only");
    expect(screen.getByRole("article", { name: finding.text })).toBeInTheDocument();
  });

  it("puts the link to the call after the evidence when its sentence is hidden", () => {
    render(<FindingBlock finding={finding} evidence={evidence} detections={detections} contract="promise_backed" hideText anchor="f" />);
    const link = screen.getByRole("link", { name: "Show in the call" });
    const did = screen.getByRole("group", { name: "Did" });
    expect(did.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
