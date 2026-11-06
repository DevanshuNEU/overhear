import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CallReportView } from "./CallReportView";
import { failedSample, needsReviewSample, passedSample } from "@/report/samples";
import { unverifiedSample } from "@/report/demo-states";
import { CONTRACT_TITLE, capitalize } from "@/report/labels";

describe("CallReportView on the failed sample", () => {
  const report = failedSample;
  const setup = () => render(<CallReportView report={report} />);

  it("leads with the verdict and the answer", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The agent said twice that it was transferring the caller");
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText(report.callId)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy call ID" })).toBeInTheDocument();
  });

  it("answers first with the broken rule, and adds no stored headline after it", () => {
    setup();
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.querySelector("[data-answer]")).toHaveTextContent("The agent said twice that it was transferring the caller, at 2:01 and 2:22. No transfer was attempted.");
    expect(h1.querySelector("[data-headline]")).toBeNull();
    expect(h1).not.toHaveTextContent(report.headline);
  });

  it("does not say a sentence twice in a row: when one finding is the lead, its section goes straight to the evidence", () => {
    const base = report.results.find((c) => c.contract === "transfer_kept")!;
    const once = { ...report, results: report.results.map((c) => (c.contract === "transfer_kept" ? { ...c, findings: base.findings.slice(0, 1) } : c)) };
    render(<CallReportView report={once} />);
    const sentence = "At 2:01 the agent said it was transferring the caller. No transfer was attempted.";
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(sentence);
    const section = screen.getByRole("region", { name: "Promised transfers happen" });
    expect(within(section).getByText(sentence)).toHaveClass("sr-only");
    expect(within(section).getByRole("group", { name: "Said" })).toBeInTheDocument();
  });

  it("keeps each finding's own sentence when the lead is the rule's template", () => {
    setup();
    const section = screen.getByRole("region", { name: "Promised transfers happen" });
    for (const f of report.results.find((c) => c.contract === "transfer_kept")!.findings) {
      expect(within(section).getByText(f.text)).not.toHaveClass("sr-only");
    }
  });

  it("shows only the claim and the sentence either side, with the whole turn behind a disclosure", () => {
    setup();
    const said = within(screen.getByRole("region", { name: "Promised transfers happen" })).getAllByRole("group", { name: "Said" })[0];
    const details = said.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getByText("Whole turn")).toBeInTheDocument();
    const preview = said.querySelector("[data-preview]")!;
    expect(preview).toHaveTextContent("Your appointment with Dr. Nair is confirmed for September 24th at 9:00 AM.");
    expect(preview).toHaveTextContent("I'll go ahead and connect you with a nurse now");
    expect(preview).toHaveTextContent("Is there anything else I can help you with before I transfer you?");
    expect(preview).not.toHaveTextContent("Now let me book that appointment");
    expect(details).toHaveTextContent("Now let me book that appointment");
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
    expect(within(section).getByText("Broken")).toBeInTheDocument();
    const findings = within(section).getAllByRole("article");
    expect(findings).toHaveLength(2);
    expect(within(findings[0]).getByText(/At 2:01 the agent said it was transferring the caller/)).toBeInTheDocument();
    const said = within(findings[1]).getByRole("group", { name: "Said" });
    expect(said).toHaveTextContent("Transferring you to a nurse now");
    // The words that made the claim are marked, not the whole turn.
    expect(within(said).getByText("Transferring you to a nurse now").tagName).toBe("MARK");
    expect(within(said).getByText("2:22")).toBeInTheDocument();
    // The Did lane proves the absence from the record: no transfer after the claim, and the tools the call did use.
    const did = within(findings[1]).getByRole("group", { name: "Did" });
    expect(did).toHaveTextContent("No transfer tool was called after 2:22.");
    expect(did).toHaveTextContent("Tools called in this call: check_availability, verify_patient, book_appointment.");
    expect(within(findings[0]).getByRole("group", { name: "Did" })).toHaveTextContent("No transfer tool was called after 2:01.");
  });

  it("collapses the contracts that held to one line each", () => {
    const { container } = setup();
    const held = Array.from(container.querySelectorAll("details")).filter((d) => d.querySelector("summary")?.textContent?.includes("Kept"));
    expect(held).toHaveLength(3);
    for (const d of held) expect(d.open).toBe(false);
    const rows = screen.getByRole("region", { name: "Said and did" });
    expect(within(rows).getByText("Promises backed by the system")).toBeInTheDocument();
  });

  it("shows what the system did for a kept promise: the call, its result and the compared details", () => {
    const { container } = setup();
    const promise = Array.from(container.querySelectorAll("details")).find((d) => d.textContent?.includes("Promises backed by the system"))!;
    // The call and its result are one line.
    expect(within(promise).getByText("book_appointment succeeded")).toBeInTheDocument();
    expect(within(promise).queryByText("Called book_appointment")).not.toBeInTheDocument();
    const spoken = Array.from(container.querySelectorAll("details")).find((d) => d.textContent?.includes("Spoken details match the booking"))!;
    const table = within(spoken).getByRole("table");
    expect(within(table).getByText("Spoken: Dr. Nair")).toBeInTheDocument();
    expect(within(table).getByText("Dr. Priya Nair")).toBeInTheDocument();
    expect(within(table).getAllByText("Matches")).toHaveLength(3);
  });

  it("leaves out the length of a call whose length is negative or not a number", () => {
    for (const duration_ms of [-1000, Number.NaN, Number.POSITIVE_INFINITY]) {
      const odd = { ...report, evidence: { ...report.evidence, callFields: { ...report.evidence.callFields, duration_ms } } };
      const { unmount } = render(<CallReportView report={odd} />);
      expect(screen.queryByText("Length")).not.toBeInTheDocument();
      expect(screen.getByText("Platform")).toBeInTheDocument();
      unmount();
    }
  });

  it("lists the other rules with what happened to each", () => {
    setup();
    const other = screen.getByRole("region", { name: "Other rules" });
    expect(within(other).getByText("Booking matches the request")).toBeInTheDocument();
    expect(within(other).getByText("Not checked")).toBeInTheDocument();
  });

  it("gives every contract a heading, open or collapsed", () => {
    setup();
    for (const title of ["Promised transfers happen", "Promises backed by the system", "Identity checked before changes", "Spoken details match the booking"]) {
      expect(screen.getByRole("heading", { level: 3, name: title })).toBeInTheDocument();
    }
  });

  it("still renders when the report's timezone cannot be read, leaving out the start time", () => {
    render(<CallReportView report={{ ...report, timezone: "Mars/Base" }} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("The agent said twice");
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
    expect(screen.queryByText("Broken")).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll("section > details[open]"))).toHaveLength(0);
  });
});

describe("CallReportView on a call that needs review", () => {
  it("states why, under the headline, before the rules", () => {
    render(<CallReportView report={needsReviewSample} />);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(needsReviewSample.reasons[0].text);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.indexOf("Why it needs review")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("Why it needs review")).toBeLessThan(headings.indexOf("Other rules"));
  });
});

describe("CallReportView on an unverified result", () => {
  const setup = () => render(<CallReportView report={unverifiedSample} />);

  it("opens each rule it could not check, with one line that points to the gap and not the gap again", () => {
    setup();
    const section = screen.getByRole("region", { name: "Promises backed by the system" });
    expect(within(section).getByText("Couldn't check")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "See what we couldn't check." })).toHaveAttribute("href", "#gaps");
    expect(within(section).queryByText("A tool result gave no success signal")).not.toBeInTheDocument();
    expect(within(section).getByRole("group", { name: "Did" })).toHaveTextContent("book_appointment gave no success signal");
  });

  it("says the gap once, with the engine's detail and the three rules it stopped", () => {
    setup();
    const gaps = screen.getByRole("region", { name: "What we couldn't check" });
    expect(within(gaps).getAllByText("A tool result gave no success signal")).toHaveLength(1);
    expect(within(gaps).getByText(/^Rules it blocks: Promises backed by the system/)).toBeInTheDocument();
    // Not repeated in the rules below. (The timeline's tag for the same gap is a link, not a second explanation.)
    const rows = screen.getByRole("region", { name: "Said and did" });
    expect(within(rows).queryByText("A tool result gave no success signal")).not.toBeInTheDocument();
  });

  it("has no why-it-needs-review section when the only reason is a rule that could not be checked", () => {
    setup();
    expect(screen.queryByRole("region", { name: "Why it needs review" })).not.toBeInTheDocument();
  });

  it("lists what we could not check before the rules, and counts the gaps in the key facts", () => {
    setup();
    expect(screen.getByRole("region", { name: "What we couldn't check" })).toBeInTheDocument();
    const facts = screen.getByRole("list", { name: "Key facts" });
    expect(within(facts).getByText("Call record only, 1 gap")).toBeInTheDocument();
  });

  it("does not pass anything it could not check", () => {
    setup();
    expect(screen.queryByText("Passed")).not.toBeInTheDocument();
    expect(screen.getAllByText("Couldn't check").length).toBeGreaterThanOrEqual(3);
  });
});
