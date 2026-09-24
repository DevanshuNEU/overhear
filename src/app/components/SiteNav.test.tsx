import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteNav } from "./SiteNav";

describe("SiteNav", () => {
  it("renders the wordmark and the three links, with a safe external repo link", () => {
    render(<SiteNav />);
    expect(screen.getByText("Overhear")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /how it works/i })).toHaveAttribute("href", "/how-it-works");
    expect(screen.getByRole("link", { name: /judge accuracy/i })).toHaveAttribute("href", "/eval");
    const repo = screen.getByRole("link", { name: /github/i });
    expect(repo).toHaveAttribute("href", "https://github.com/DevanshuNEU/retell");
    expect(repo).toHaveAttribute("target", "_blank");
    expect(repo).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });
});
