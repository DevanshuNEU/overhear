import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CallTimeline } from "./CallTimeline";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";

describe("CallTimeline", () => {
  it("lists every item of the call in order, under its own heading", () => {
    render(<CallTimeline report={failedSample} />);
    const section = screen.getByRole("region", { name: "The call" });
    const items = within(section).getAllByRole("listitem").filter((li) => li.id.startsWith("item-"));
    expect(items).toHaveLength(failedSample.evidence.items.length);
    expect(items.map((li) => li.id)).toEqual(failedSample.evidence.items.map((it) => `item-${it.seq}`));
  });

  it("names who spoke and when, and keeps the words as spoken", () => {
    render(<CallTimeline report={failedSample} />);
    const turn = document.getElementById("item-27")!;
    expect(within(turn).getByText("Agent")).toBeInTheDocument();
    expect(within(turn).getByText("2:22")).toBeInTheDocument();
    expect(turn).toHaveTextContent("Transferring you to a nurse now");
    expect(within(document.getElementById("item-15")!).getByText("Caller")).toBeInTheDocument();
  });

  it("shows tool calls, results and raw detail as quiet lines, with raw detail closed", () => {
    render(<CallTimeline report={failedSample} />);
    const call = document.getElementById("item-22")!;
    expect(call).toHaveTextContent("Called book_appointment");
    expect((call.querySelector("details[data-raw]") as HTMLDetailsElement).open).toBe(false);
    expect(document.getElementById("item-24")).toHaveTextContent("book_appointment succeeded");
  });

  it("keeps what the system did on one line: the line, its raw detail and its tags together", () => {
    render(<CallTimeline report={failedSample} />);
    const row = document.getElementById("item-22")!.querySelector("[data-system]")!;
    expect(row).toHaveTextContent("Called book_appointment");
    expect(row.querySelector("details[data-raw]")).not.toBeNull();
    expect(within(row as HTMLElement).getAllByRole("link").length).toBe(3);
  });

  it("holds spoken words to a readable line length", () => {
    render(<CallTimeline report={failedSample} />);
    const words = document.getElementById("item-25")!.querySelector("p")!;
    expect(words.className).toContain("max-w-[68ch]");
  });

  it("tags an item with each finding that cites it, linking back to the finding", () => {
    render(<CallTimeline report={failedSample} />);
    const turn25 = document.getElementById("item-25")!;
    const links = within(turn25).getAllByRole("link");
    // The result is part of the link's name, so it is never colour alone.
    expect(links.map((a) => a.textContent)).toEqual([
      "Promises backed by the system, Passed",
      "Spoken details match the booking, Passed",
      "Transfers kept, 1 of 2, Violated",
    ]);
    expect(links[2]).toHaveAttribute("href", "#finding-transfer_kept-0");
    // An item no finding cites carries no tag.
    expect(within(document.getElementById("item-1")!).queryAllByRole("link")).toHaveLength(0);
  });

  it("draws a thread for each finding that needs attention, and none for a call that held", () => {
    const { container, rerender } = render(<CallTimeline report={failedSample} />);
    expect(container.querySelectorAll("[data-rail]").length).toBeGreaterThan(0);
    for (const rail of container.querySelectorAll("[data-rail]")) expect(rail.closest("[aria-hidden='true']")).not.toBeNull();
    rerender(<CallTimeline report={passedSample} />);
    expect(container.querySelectorAll("[data-rail]")).toHaveLength(0);
  });

  it("renders a call with no findings as a plain timeline", () => {
    render(<CallTimeline report={needsReviewSample} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(document.getElementById("item-9")).toHaveTextContent("check_availability failed");
  });

  it("marks a rail's first item with a dot, the items between with a line, and its last with a dot", () => {
    render(<CallTimeline report={unverifiedSample} />);
    const marks = (seq: number) => Array.from(document.getElementById(`item-${seq}`)!.querySelectorAll("[data-rail]")).map((r) => r.getAttribute("data-mark"));
    expect(marks(20)).toEqual(["dot"]); // the identity check starts its rail
    expect(marks(21)).toEqual(["line"]); // an agent turn it passes by
    expect(marks(22)).toEqual(["dot"]); // and cites again
  });

  it("says so when the order of the items could not be established", () => {
    const none = { ...failedSample, evidence: { ...failedSample.evidence, ordering: "none" as const } };
    const { rerender } = render(<CallTimeline report={none} />);
    expect(screen.getByText("The order of these items couldn't be established. They are listed as received.")).toBeInTheDocument();
    rerender(<CallTimeline report={failedSample} />);
    expect(screen.queryByText(/couldn't be established/)).not.toBeInTheDocument();
  });

  it("tags what the backend logged, as the said | did rows do", () => {
    const backend = {
      kind: "backend_action" as const, seq: 49, id: "ae_1", toolCallId: "tc_04", tool: "book_appointment", args: {}, result: { ok: true }, ok: true,
      ts: "2026-11-05T10:00:00Z", link: { toolCallId: "tc_04", by: "tool_call_id" as const },
    };
    const report = { ...passedSample, evidence: { ...passedSample.evidence, tier: 2 as const, items: [...passedSample.evidence.items, backend] } };
    render(<CallTimeline report={report} />);
    expect(within(document.getElementById("item-49")!).getByText("Backend log")).toBeInTheDocument();
    expect(within(document.getElementById("item-48")!).queryByText("Backend log")).not.toBeInTheDocument();
  });
});
