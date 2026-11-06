import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CallReportView } from "./CallReportView";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { CONTRACT_TITLE, capitalize } from "@/report/labels";

describe("CallReportView on the failed sample", () => {
  const report = failedSample;
  const setup = () => render(<CallReportView report={report} />);

  it("leads with the verdict and the headline", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(report.headline);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(report.callId)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy call ID" })).toBeInTheDocument();
  });

  it("shows the key facts with units and a denominator", () => {
    setup();
    const facts = screen.getByRole("list", { name: "Key facts" });
    expect(within(facts).getByText("Retell")).toBeInTheDocument();
    expect(within(facts).getByText("2 min 41 s")).toBeInTheDocument();
    expect(within(facts).getByText("Call record only")).toBeInTheDocument();
    expect(within(facts).getByText("1 broken, 3 kept")).toBeInTheDocument();
    expect(within(facts).getByText(/Sep 23, 2026.*UTC/)).toBeInTheDocument();
  });

  it("opens the violated contract with its finding, said words and an empty did lane", () => {
    setup();
    const section = screen.getByRole("region", { name: capitalize(CONTRACT_TITLE.transfer_kept) });
    expect(within(section).getByText("Violated")).toBeInTheDocument();
    const findings = within(section).getAllByRole("article");
    expect(findings).toHaveLength(2);
    expect(within(findings[0]).getByText(/At 2:01 the agent said it was transferring the caller/)).toBeInTheDocument();
    const said = within(findings[1]).getByRole("group", { name: "Said" });
    expect(said).toHaveTextContent("Transferring you to a nurse now");
    // The words that made the claim are marked, not the whole turn.
    expect(within(said).getByText("Transferring you to a nurse now").tagName).toBe("MARK");
    expect(within(said).getByText("2:22")).toBeInTheDocument();
    expect(within(findings[1]).getByRole("group", { name: "Did" })).toHaveTextContent("Nothing in the call record.");
  });

  it("collapses the contracts that held to one line each", () => {
    const { container } = setup();
    const held = Array.from(container.querySelectorAll("details")).filter((d) => d.querySelector("summary")?.textContent?.includes("Passed"));
    expect(held).toHaveLength(3);
    for (const d of held) expect(d.open).toBe(false);
    expect(screen.getByText(/Promises backed by the system/)).toBeInTheDocument();
  });

  it("shows what the system did for a kept promise: the call, its result and the compared details", () => {
    const { container } = setup();
    const promise = Array.from(container.querySelectorAll("details")).find((d) => d.textContent?.includes("Promises backed by the system"))!;
    expect(within(promise).getByText("Called book_appointment")).toBeInTheDocument();
    expect(within(promise).getByText("book_appointment succeeded")).toBeInTheDocument();
    const spoken = Array.from(container.querySelectorAll("details")).find((d) => d.textContent?.includes("Spoken details match the booking"))!;
    const table = within(spoken).getByRole("table");
    expect(within(table).getByText("Spoken: Dr. Nair")).toBeInTheDocument();
    expect(within(table).getByText("Dr. Priya Nair")).toBeInTheDocument();
    expect(within(table).getAllByText("Matches")).toHaveLength(3);
  });

  it("lists the other rules with what happened to each", () => {
    setup();
    const other = screen.getByRole("region", { name: "Other rules" });
    expect(within(other).getByText("Booking matches the request")).toBeInTheDocument();
    expect(within(other).getByText("Not checked")).toBeInTheDocument();
  });

  it("gives every contract a heading, open or collapsed", () => {
    setup();
    for (const title of ["Transfers kept", "Promises backed by the system", "Identity checked before changes", "Spoken details match the booking"]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
  });

  it("still renders when the report's timezone cannot be read, leaving out the start time", () => {
    render(<CallReportView report={{ ...report, timezone: "Mars/Base" }} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(report.headline);
    expect(screen.queryByText("Started")).not.toBeInTheDocument();
  });

  it("keeps raw payloads behind a disclosure", () => {
    const { container } = setup();
    const raw = container.querySelectorAll("details[data-raw]");
    expect(raw.length).toBeGreaterThan(0);
    for (const d of raw) expect((d as HTMLDetailsElement).open).toBe(false);
  });
});

describe("CallReportView on a call where no rule applied", () => {
  it("does not call the rules that did not apply unchecked", () => {
    render(<CallReportView report={needsReviewSample} />);
    const other = screen.getByRole("region", { name: "Other rules" });
    expect(within(other).getAllByText("Doesn't apply")).toHaveLength(5);
    expect(within(other).queryByText("Not checked")).not.toBeInTheDocument();
  });
});

describe("CallReportView on the passed sample", () => {
  it("is calm: no violated section, the note stays in the headline, every rule collapsed", () => {
    const { container } = render(<CallReportView report={passedSample} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(passedSample.headline);
    expect(screen.queryByText("Violated")).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll("section > details[open]"))).toHaveLength(0);
  });
});
