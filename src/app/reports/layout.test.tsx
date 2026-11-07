import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ReportsLayout, { dynamic } from "./layout";

afterEach(() => vi.unstubAllEnvs());

const shell = () => render(<ReportsLayout><p>the call</p></ReportsLayout>);

describe("the way back from a call screen", () => {
  it("in local mode, links to the call list and says so", () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    shell();
    const back = screen.getByRole("link", { name: "All calls" });
    expect(back).toHaveAttribute("href", "/");
  });

  it("on a hosted copy, links to the demo, since / only redirects there", () => {
    vi.stubEnv("OVERHEAR_LOCAL", "");
    shell();
    expect(screen.queryByRole("link", { name: "All calls" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the demo" })).toHaveAttribute("href", "/demo");
  });

  it("keeps the product name on screen beside the link", () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    shell();
    expect(screen.getByText("Overhear")).toBeInTheDocument();
  });

  it("can be reached by keyboard, after the skip link and before the call, with a visible focus ring and a 44 px target", () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    shell();
    const links = screen.getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Skip to the call", "All calls"]);
    const back = screen.getByRole("link", { name: "All calls" });
    expect(back).not.toHaveAttribute("tabindex");
    back.focus();
    expect(back).toHaveFocus();
    expect(back).toHaveClass("min-h-11", "focus-visible:outline-2", "focus-visible:outline-report-accent", "text-report-accent");
  });

  it("is read when a request arrives, so a build made without local mode cannot bake the hosted link into a local copy", () => {
    expect(dynamic).toBe("force-dynamic");
  });
});
