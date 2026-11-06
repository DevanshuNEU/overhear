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
    expect(container.querySelector("[data-delayed]")).not.toBeNull();
  });
});

describe("NotFoundView", () => {
  it("names the call, says why, and says what to do", () => {
    render(<NotFoundView />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("No report for this call.");
    expect(screen.getByText(/call_missing/)).toBeInTheDocument();
    expect(screen.getByText("Check the ID in the link, then open the call again.")).toBeInTheDocument();
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

  it("shows no more than the first few problems, and how many there are", () => {
    const many = Array.from({ length: 12 }, (_, i) => `field ${i}: wrong`);
    const { container } = render(<UnreadableView callId="call_x" problems={many} />);
    expect(within(container.querySelector("details")!).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("12 problems, first 5 shown")).toBeInTheDocument();
  });
});
