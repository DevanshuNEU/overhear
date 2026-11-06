import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CallTimeline } from "./CallTimeline";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";

const rowOf = (seq: number) => document.getElementById(`item-${seq}`)!.closest("li")!;

describe("CallTimeline", () => {
  it("gives every item of the call its own anchor, in rows that are fewer than the items", () => {
    render(<CallTimeline report={failedSample} />);
    const section = screen.getByRole("region", { name: "The call" });
    for (const it of failedSample.evidence.items) expect(document.getElementById(`item-${it.seq}`)).not.toBeNull();
    expect(within(section).getAllByRole("listitem").length).toBeLessThan(failedSample.evidence.items.length);
  });

  it("names who spoke and when once for turns by one speaker, and keeps the words as spoken", () => {
    render(<CallTimeline report={failedSample} />);
    const callers = rowOf(2);
    expect(rowOf(3)).toBe(callers);
    expect(rowOf(4)).toBe(callers);
    expect(within(callers).getAllByText("Caller")).toHaveLength(1);
    expect(within(callers).getByText("0:06")).toBeInTheDocument();
    expect(within(callers).queryByText("0:13")).not.toBeInTheDocument();
    expect(callers).toHaveTextContent("with whatever the available doctor is.");
    expect(rowOf(27)).toHaveTextContent("Transferring you to a nurse now");
    expect(within(rowOf(27)).getByText("Agent")).toBeInTheDocument();
  });

  it("does not group turns across something the system did", () => {
    render(<CallTimeline report={failedSample} />);
    expect(rowOf(5)).not.toBe(rowOf(7));
  });

  it("shows a tool call and its result as one line, with raw detail on that line and closed", () => {
    render(<CallTimeline report={failedSample} />);
    const row = rowOf(22);
    expect(rowOf(24)).toBe(row);
    expect(row).toHaveTextContent("book_appointment succeeded");
    expect(row).not.toHaveTextContent("Called book_appointment");
    const system = row.querySelector("[data-system]")!;
    expect((system.querySelector("details[data-raw]") as HTMLDetailsElement).open).toBe(false);
    expect(system.textContent).not.toContain("check_availability");
  });

  it("holds spoken words to a readable line length", () => {
    render(<CallTimeline report={failedSample} />);
    expect(rowOf(25).querySelector("p")!.className).toContain("max-w-[68ch]");
  });

  it("tags only the findings that need attention, linking back, and never the ones that held", () => {
    render(<CallTimeline report={failedSample} />);
    const links = within(rowOf(25)).getAllByRole("link");
    // The result is part of the link's name, so it is never colour alone.
    expect(links.map((a) => a.textContent)).toEqual(["Promised transfers happen, 1 of 2, Broken"]);
    expect(links[0]).toHaveAttribute("href", "#finding-transfer_kept-0");
    // The passed rules that cite the booking call leave it untagged.
    expect(within(rowOf(22)).queryAllByRole("link")).toHaveLength(0);
    expect(within(rowOf(1)).queryAllByRole("link")).toHaveLength(0);
  });

  it("tags nothing on a call that held", () => {
    render(<CallTimeline report={passedSample} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("draws a thread for each finding that needs attention, and none for a call that held", () => {
    const { container, rerender } = render(<CallTimeline report={failedSample} />);
    expect(container.querySelectorAll("[data-rail]").length).toBeGreaterThan(0);
    for (const rail of container.querySelectorAll("[data-rail]")) expect(rail.closest("[aria-hidden='true']")).not.toBeNull();
    rerender(<CallTimeline report={passedSample} />);
    expect(container.querySelectorAll("[data-rail]")).toHaveLength(0);
  });

  it("tags the items a review reason rests on and links to the reason", () => {
    render(<CallTimeline report={needsReviewSample} />);
    const row = rowOf(9);
    expect(row).toHaveTextContent("check_availability failed");
    const link = within(row).getByRole("link");
    expect(link).toHaveTextContent("Unanswered request, Couldn't check");
    expect(link).toHaveAttribute("href", "#reason-0");
    expect(within(rowOf(2)).queryAllByRole("link")).toHaveLength(0);
  });

  it("tags an item with a gap and with the rules it stopped, and links to them", () => {
    render(<CallTimeline report={unverifiedSample} />);
    const links = within(rowOf(33)).getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(links).toContainEqual(["A tool result gave no success signal, Couldn't check", "#gap-0"]);
    expect(links).toContainEqual(["Promises backed by the system, Couldn't check", "#finding-promise_backed-0"]);
  });

  it("marks a rail's first row with a dot, the rows between with a line, and its last row with a dot", () => {
    render(<CallTimeline report={unverifiedSample} />);
    const marks = (seq: number) => Array.from(rowOf(seq).querySelectorAll("[data-rail]")).map((r) => r.getAttribute("data-mark"));
    expect(marks(20)).toEqual(["dot"]); // the identity check starts its rail
    expect(marks(21)).toEqual(["line"]); // the agent's words it passes by
    expect(marks(31).length).toBeGreaterThan(1); // the booking call is where several rails meet
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
    expect(within(rowOf(49)).getByText("Backend log")).toBeInTheDocument();
    expect(within(rowOf(48)).queryByText("Backend log")).not.toBeInTheDocument();
  });
});
