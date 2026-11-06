import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AbsenceProof } from "./AbsenceProof";
import { failedSample } from "@/report/samples";
import type { Evidence, Policy } from "@/report/schema";

const transferFinding = failedSample.results.find((c) => c.contract === "transfer_kept")!.findings[0];

describe("AbsenceProof", () => {
  it("shows what the record holds: no transfer after the claim, and the tools the call did use", () => {
    render(<AbsenceProof evidence={failedSample.evidence} policy={failedSample.policy} contract="transfer_kept" finding={transferFinding} />);
    expect(screen.getByText("No transfer tool was called after 2:01.")).toBeInTheDocument();
    expect(screen.getByText("Tools called in this call: check_availability, verify_patient, book_appointment.")).toBeInTheDocument();
  });

  it("says plainly when the call used no tools", () => {
    const e: Evidence = { ...failedSample.evidence, items: failedSample.evidence.items.filter((i) => i.kind === "turn").map((it, i) => ({ ...it, seq: i + 1 })) };
    render(<AbsenceProof evidence={e} policy={failedSample.policy} contract="transfer_kept" finding={{ ...transferFinding, said: [1] }} />);
    expect(screen.getByText("No tools were called in this call.")).toBeInTheDocument();
  });

  it("does not claim an absence the record contradicts", () => {
    const policy: Policy = { ...failedSample.policy, tools: { ...failedSample.policy.tools, transfer_call: { role: "transfer" } } };
    const e: Evidence = {
      ...failedSample.evidence,
      items: [...failedSample.evidence.items, { kind: "tool_call", seq: failedSample.evidence.items.length + 1, id: "tc_99", name: "transfer_call", args: {} }],
    };
    render(<AbsenceProof evidence={e} policy={policy} contract="transfer_kept" finding={transferFinding} />);
    expect(screen.queryByText(/No transfer tool was called/)).not.toBeInTheDocument();
    expect(screen.getByText("No matching action in the call record.")).toBeInTheDocument();
    expect(screen.getByText(/Tools called in this call: .*transfer_call/)).toBeInTheDocument();
  });

  it("does not repeat a tool in the list, and names the claim's moment when it has no time", () => {
    const e: Evidence = {
      ...failedSample.evidence,
      items: failedSample.evidence.items.map((it) => (it.seq === 25 && it.kind === "turn" ? { ...it, startSec: null } : it)),
    };
    render(<AbsenceProof evidence={e} policy={failedSample.policy} contract="transfer_kept" finding={transferFinding} />);
    expect(screen.getByText("No transfer tool was called after the claim.")).toBeInTheDocument();
  });

  it("says no change tool came before a promise that nothing backed", () => {
    const finding = { ...transferFinding, said: [25], did: [] };
    const e: Evidence = { ...failedSample.evidence, items: failedSample.evidence.items.filter((i) => !(i.kind !== "turn" && (i.seq === 22 || i.seq === 24))) };
    render(<AbsenceProof evidence={e} policy={failedSample.policy} contract="promise_backed" finding={finding} />);
    expect(screen.getByText("No tool that changes a booking was called before 2:01.")).toBeInTheDocument();
  });

  it("claims no absence when the finding is not a broken one, and says nothing it cannot back", () => {
    const finding = { ...transferFinding, result: "unverified" as const, did: [] };
    const gapped: Evidence = { ...failedSample.evidence, gaps: [{ code: "missing_tool_transcript", detail: "The platform sent no tool calls.", seqs: [25] }] };
    render(<AbsenceProof evidence={gapped} policy={failedSample.policy} contract="transfer_kept" finding={finding} />);
    expect(screen.queryByText(/No transfer tool was called/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Tools called in this call/)).not.toBeInTheDocument();
    expect(screen.getByText("No matching action in the call record.")).toBeInTheDocument();
  });

  it("claims no absence when the order of the items is not known", () => {
    for (const ordering of ["none", "timestamps"] as const) {
      const { unmount } = render(<AbsenceProof evidence={{ ...failedSample.evidence, ordering }} policy={failedSample.policy} contract="transfer_kept" finding={transferFinding} />);
      expect(screen.queryByText(/No transfer tool was called/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("claims no absence when something that looks like a transfer is in the record", () => {
    const base = failedSample.evidence.items.length;
    const event: Evidence = { ...failedSample.evidence, items: [...failedSample.evidence.items, { kind: "event", seq: base + 1, type: "transfer_started", data: {} }] };
    render(<AbsenceProof evidence={event} policy={failedSample.policy} contract="transfer_kept" finding={transferFinding} />);
    expect(screen.queryByText(/No transfer tool was called/)).not.toBeInTheDocument();
  });

  it("claims no absence when a tool of unknown role was called after the claim", () => {
    const base = failedSample.evidence.items.length;
    const e: Evidence = { ...failedSample.evidence, items: [...failedSample.evidence.items, { kind: "tool_call", seq: base + 1, id: "tc_x", name: "mystery_tool", args: {} }] };
    render(<AbsenceProof evidence={e} policy={failedSample.policy} contract="transfer_kept" finding={transferFinding} />);
    expect(screen.queryByText(/No transfer tool was called/)).not.toBeInTheDocument();
    expect(screen.getByText(/Tools called in this call: .*mystery_tool/)).toBeInTheDocument();
  });
});
