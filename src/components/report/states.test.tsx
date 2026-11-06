import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LoadingView } from "./LoadingView";
import { NotFoundView } from "./NotFoundView";
import { UnreadableView } from "./UnreadableView";

let pathname = "/reports/call_missing";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(() => {
  pathname = "/reports/call_missing";
});

describe("LoadingView", () => {
  it("tells a screen reader the call is loading and holds the page's place", () => {
    render(<LoadingView />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading the call");
    expect(status.closest("[aria-busy='true']")).not.toBeNull();
  });

  it("waits before showing anything, so a fast load never flashes", () => {
    const { container } = render(<LoadingView />);
    expect(container.querySelector("[data-delayed]")).toHaveClass("report-delayed");
    // The class holds the delay: opacity 0, revealed after 250 ms, and under reduced motion the delay stays.
    const css = fs.readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
    expect(css).toMatch(/\.report-delayed \{[^}]*opacity: 0;[^}]*animation: report-reveal 150ms ease-out 250ms forwards/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.report-delayed \{[^}]*250ms/);
  });
});

describe("NotFoundView", () => {
  it("names the call, says why, and says what to do", () => {
    render(<NotFoundView />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No report for this call.");
    expect(screen.getByText(/call_missing/)).toBeInTheDocument();
    expect(screen.getByText("Check the ID in the link, then open the call again.")).toBeInTheDocument();
  });

  it("reads an encoded id, and survives a malformed escape", () => {
    pathname = "/reports/call%2Dx";
    const { unmount } = render(<NotFoundView />);
    expect(screen.getByText(/call-x/)).toBeInTheDocument();
    unmount();
    pathname = "/reports/%E0%A4%A";
    render(<NotFoundView />);
    expect(screen.getByText("Overhear holds no report with this ID.")).toBeInTheDocument();
  });

  it("does not repeat text that is not shaped like an id", () => {
    pathname = "/reports/Contact%20support%20at%20x";
    render(<NotFoundView />);
    expect(screen.queryByText(/Contact support/)).not.toBeInTheDocument();
    expect(screen.getByText("Overhear holds no report with this ID.")).toBeInTheDocument();
  });

  it("copes with an address it cannot read an id from", () => {
    pathname = "/";
    render(<NotFoundView />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No report for this call.");
  });
});

describe("UnreadableView", () => {
  const problems = ["verdict: verdict is passed but the results give failed", "results.3.result: result is passed but the worst finding is violated"];

  it("says plainly that the report cannot be read and shows no verdict", () => {
    render(<UnreadableView callId="call_demo_unreadable" problems={problems} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("This report can't be read.");
    expect(screen.getByText(/call_demo_unreadable/)).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.queryByText("Passed")).not.toBeInTheDocument();
  });

  it("lists what failed behind a disclosure and says what to do", () => {
    const { container } = render(<UnreadableView callId="call_x" problems={problems} />);
    expect(screen.getByText("Regenerate the report, then reload this page.")).toBeInTheDocument();
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    expect(within(details).getAllByRole("listitem")).toHaveLength(2);
  });

  it("cuts a long problem and does not repeat a call id that is not shaped like one", () => {
    const { container } = render(<UnreadableView callId="Contact support at x" problems={["a".repeat(500)]} />);
    expect(container.querySelector("li")!.textContent!.length).toBeLessThan(220);
    expect(screen.queryByText(/Contact support/)).not.toBeInTheDocument();
    expect(screen.getByText("This report doesn't match the report format, so Overhear won't show it.")).toBeInTheDocument();
  });

  it("shows no more than the first few problems, and how many there are", () => {
    const many = Array.from({ length: 12 }, (_, i) => `field ${i}: wrong`);
    const { container } = render(<UnreadableView callId="call_x" problems={many} />);
    expect(within(container.querySelector("details")!).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("12 problems, first 5 shown")).toBeInTheDocument();
  });
});
