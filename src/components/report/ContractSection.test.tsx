import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ContractSection } from "./ContractSection";
import { unverifiedSample } from "@/report/demo-states";
import { failedSample } from "@/report/samples";

describe("ContractSection", () => {
  const unchecked = unverifiedSample.results.find((c) => c.contract === "promise_backed")!;

  it("gives a rule that could not be checked one line that points to the gaps section", () => {
    render(<ContractSection contract={unchecked} evidence={unverifiedSample.evidence} detections={unverifiedSample.detections} policy={unverifiedSample.policy} />);
    const section = screen.getByRole("region", { name: "Promises backed by the system" });
    const link = within(section).getByRole("link", { name: "See what we couldn't check." });
    expect(link).toHaveAttribute("href", "#gaps");
    expect(within(section).getAllByRole("link", { name: "See what we couldn't check." })).toHaveLength(1);
    // The gap itself is not repeated here.
    expect(within(section).queryByText("A tool result gave no success signal")).not.toBeInTheDocument();
  });

  it("does not point at a gaps section that is not there", () => {
    render(<ContractSection contract={unchecked} evidence={{ ...unverifiedSample.evidence, gaps: [] }} detections={unverifiedSample.detections} policy={unverifiedSample.policy} />);
    expect(screen.queryByRole("link", { name: "See what we couldn't check." })).not.toBeInTheDocument();
  });

  it("does not point a rule that broke or held at the gaps section", () => {
    const broken = failedSample.results.find((c) => c.contract === "transfer_kept")!;
    render(<ContractSection contract={broken} evidence={failedSample.evidence} detections={failedSample.detections} policy={failedSample.policy} />);
    expect(screen.queryByRole("link", { name: "See what we couldn't check." })).not.toBeInTheDocument();
  });
});
