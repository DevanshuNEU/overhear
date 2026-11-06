// The engine's first release checks scheduling only: the packs are ["scheduling"], so there is no
// verified_before_change result, and four contracts remain (the request one not run). The screen has to
// show that shape with nothing missing or broken. These reports are built from the samples and must still
// pass the schema, so the test cannot drift from the contract.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CallReportView } from "./CallReportView";
import { CallReportSchema, type CallReport } from "@/report/schema";
import { failedSample, passedSample } from "@/report/samples";

function schedulingOnly(sample: CallReport): CallReport {
  return CallReportSchema.parse({
    ...structuredClone(sample),
    policy: { ...structuredClone(sample.policy), packs: ["scheduling"] },
    results: sample.results.filter((c) => c.contract !== "verified_before_change"),
  });
}

describe("the first engine release's report shape (scheduling only)", () => {
  it("is a valid report with exactly the four contracts", () => {
    for (const sample of [failedSample, passedSample]) {
      const report = schedulingOnly(sample);
      expect(report.results.map((c) => c.contract)).toEqual(["promise_backed", "spoken_matches_committed", "transfer_kept", "committed_matches_request"]);
      expect(report.results.find((c) => c.contract === "committed_matches_request")!.result).toBe("not_run");
    }
  });

  it("shows the failed call with no identity rule, no empty section and the right counts", () => {
    render(<CallReportView report={schedulingOnly(failedSample)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The agent said twice that it was transferring the caller");
    expect(screen.queryByText("Identity checked before changes")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Promised transfers happen" })).toHaveTextContent("Broken");
    for (const title of ["Promises backed by the system", "Spoken details match the booking"]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
    expect(within(screen.getByRole("list", { name: "Key facts" })).getByText("1 broken, 2 kept")).toBeInTheDocument();
    const other = screen.getByRole("region", { name: "Other rules" });
    expect(within(other).getByText("Booking matches the request")).toBeInTheDocument();
    expect(within(other).getByText("Not checked")).toBeInTheDocument();
  });

  it("shows the passed call calmly, with its note, and every rule that ran collapsed", () => {
    const { container } = render(<CallReportView report={schedulingOnly(passedSample)} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Every promise that applied was kept. The caller's request wasn't checked.");
    expect(screen.queryByText("Identity checked before changes")).not.toBeInTheDocument();
    expect(screen.queryByText("Broken")).not.toBeInTheDocument();
    expect(container.querySelectorAll("section > details")).toHaveLength(2);
    expect(within(screen.getByRole("list", { name: "Key facts" })).getByText("2 kept")).toBeInTheDocument();
  });
});
