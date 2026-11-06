import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DidLane } from "./EvidenceLanes";
import type { Evidence } from "@/report/schema";

const base: Evidence = { callId: "c", platform: "retell", agentVersion: null, tier: 1, ordering: "sequence", callFields: {}, callStartMs: null, gaps: [], items: [] };
const call = (seq: number, id: string, name: string) => ({ kind: "tool_call" as const, seq, id, name, args: {} });
const result = (seq: number, id: string, payload: unknown, ok: boolean | null = true) => ({ kind: "tool_result" as const, seq, id, ok, platformOk: ok, payload });

describe("DidLane", () => {
  it("names a result by the call it answers", () => {
    const e: Evidence = { ...base, items: [call(1, "t", "check_availability"), result(2, "t", {})] };
    render(<DidLane evidence={e} seqs={[2]} />);
    expect(screen.getByText("check_availability succeeded")).toBeInTheDocument();
  });

  it("does not name a result whose call id belongs to more than one call", () => {
    const e: Evidence = { ...base, items: [call(1, "t", "check_availability"), call(2, "t", "book_appointment"), result(3, "t", {})] };
    render(<DidLane evidence={e} seqs={[3]} />);
    expect(screen.queryByText(/check_availability/)).not.toBeInTheDocument();
    expect(screen.queryByText(/book_appointment/)).not.toBeInTheDocument();
    expect(screen.getByText("t succeeded")).toBeInTheDocument();
  });

  it("lets a long action name wrap instead of widening the page", () => {
    const e: Evidence = { ...base, items: [call(1, "t", "a_very_long_tool_name_".repeat(8))] };
    render(<DidLane evidence={e} seqs={[1]} />);
    const line = document.querySelector("[data-line]")!;
    expect(line.className).toContain("min-w-0");
    expect(line.className).toContain("[overflow-wrap:anywhere]");
  });

  it("still renders when a raw record cannot be turned into text, and says so in the disclosure", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const payload of [BigInt(7), circular]) {
      const e: Evidence = { ...base, items: [call(1, "t", "check_availability"), result(2, "t", payload)] };
      const { container, unmount } = render(<DidLane evidence={e} seqs={[1, 2]} />);
      const all = container.querySelectorAll("details[data-raw]");
      const details = all[all.length - 1]; // the result's record, after the call's
      fireEvent.click(details.querySelector("summary")!);
      expect(details).toHaveTextContent("The raw record couldn't be shown.");
      unmount();
    }
  });
});
