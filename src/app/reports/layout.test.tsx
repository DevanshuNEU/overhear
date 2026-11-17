import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { visit } from "@/test-utils/fakeNavigation";
import { RUN_IT_URL } from "@/app/sampleListWords";
import ReportsLayout, { dynamic } from "./layout";

vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), ...(await import("@/test-utils/fakeNavigation")).navigationMock }));

beforeEach(() => {
  window.sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  visit("/reports/call_1", { callId: "call_1" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const shell = () => render(<ReportsLayout><p>the call</p></ReportsLayout>);

describe("the shell on a local call report", () => {
  it("has the product navigation, with Calls marked as the current section but not as the page", () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    shell();
    expect(screen.getByRole("link", { name: "Overhear" })).toHaveAttribute("href", "/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Calls" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "Calls" })).toHaveAttribute("aria-current", "true");
    expect(within(nav).getByRole("link", { name: "Calls" })).toHaveClass("text-report-accent");
    expect(within(nav).getByRole("link", { name: "Test call" })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByRole("link", { name: "Test call" })).toHaveAttribute("href", "/test-call");
    expect(screen.getByText("Connected to Retell.")).toHaveClass("text-report-muted");
  });

  it("has a way back to the list under the shell", () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    shell();
    expect(screen.getByRole("link", { name: "Back to all calls" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Back to the demo" })).not.toBeInTheDocument();
  });

  it("can be reached by keyboard, after the skip link and before the call, with a visible focus ring and a 44 px target", () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    shell();
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Skip to the call", "Overhear", "Calls", "Test call", "Back to all calls"]);
    const back = screen.getByRole("link", { name: "Back to all calls" });
    expect(back).not.toHaveAttribute("tabindex");
    back.focus();
    expect(back).toHaveFocus();
    expect(back).toHaveClass("min-h-11", "focus-visible:outline-2", "focus-visible:outline-report-accent", "text-report-accent");
    for (const name of ["Overhear", "Calls", "Test call"]) expect(screen.getByRole("link", { name })).toHaveClass("min-h-11", "focus-visible:outline-2", "focus-visible:outline-report-accent");
  });
});

describe("the shell on a hosted copy", () => {
  beforeEach(() => vi.stubEnv("OVERHEAR_LOCAL", ""));

  it("has the hosted navigation: Overhear and Calls, no Test call, the note and the way to run it on your calls", () => {
    shell();
    expect(screen.getByRole("link", { name: "Overhear" })).toHaveAttribute("href", "/");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Calls" })).toHaveAttribute("aria-current", "true");
    expect(within(nav).queryByRole("link", { name: "Test call" })).not.toBeInTheDocument();
    expect(screen.getByText("Sample calls from our demo agent.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Run it on your calls" })).toHaveAttribute("href", RUN_IT_URL);
    expect(screen.queryByText("Connected to Retell.")).not.toBeInTheDocument();
  });

  it("goes back to the sample calls and never to the old demo", () => {
    shell();
    expect(screen.getByRole("link", { name: "Back to sample calls" })).toHaveAttribute("href", "/");
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).not.toMatch(/^\/(demo|how-it-works|eval)/);
  });

  it("steps along the sample calls without asking the pull for anything", async () => {
    visit("/reports/call_sample_failed?from=failed", { callId: "call_sample_failed" });
    shell();
    expect(screen.getByRole("link", { name: "Back to failed sample calls" })).toHaveAttribute("href", "/?show=failed");
    expect(await screen.findByRole("link", { name: "Next call" })).toHaveAttribute("href", expect.stringMatching(/^\/reports\/call_[a-z_]+\?from=failed$/));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("the layout", () => {
  it("is read when a request arrives, so a build made without local mode cannot bake the hosted link into a local copy", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
