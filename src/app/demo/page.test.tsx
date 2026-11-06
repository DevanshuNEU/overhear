// The demo dashboard, now at /demo, renders as it did at /: the hero, the web-call widget, the try-it card and the
// signal log, with every call linking under /demo/calls. The database is faked; the page's props are unchanged.
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { CallSummary } from "@/qa/queries";

const calls: CallSummary[] = [
  {
    id: "call_demo_1",
    status: "scored",
    composite: 0.5,
    failureCategories: ["hallucinated_slot"],
    retellSentiment: "Negative",
    scoredAt: "2026-11-05T10:00:00.000Z",
    startedAt: "2026-11-05T09:58:00.000Z",
  },
];

vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/demo/ensure", () => ({ ensureDemoData: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/qa/queries", () => ({
  listCalls: vi.fn(async () => calls),
  failureBreakdown: vi.fn(async () => [{ category: "hallucinated_slot", count: 1 }]),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("retell-client-js-sdk", () => ({
  RetellWebClient: class {
    on() {
      return this;
    }
    stopCall() {}
    removeAllListeners() {}
    startCall() {
      return Promise.resolve();
    }
  },
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

describe("/demo", () => {
  it("renders the demo dashboard with the web-call widget and the signal log", async () => {
    const { default: DemoHome, dynamic } = await import("./page");
    expect(dynamic).toBe("force-dynamic");
    render(await DemoHome());

    expect(screen.getByRole("button", { name: "Talk to the scheduling agent" })).toBeInTheDocument();
    expect(screen.getByText("Try it yourself")).toBeInTheDocument();
    const log = screen.getByRole("heading", { name: "Signal log" }).closest("section")!;
    expect(within(log).getByRole("link", { name: /call_demo_1/ })).toHaveAttribute("href", "/demo/calls/call_demo_1");
    expect(screen.getByRole("link", { name: "Overhear" })).toHaveAttribute("href", "/demo");
  });

  it("uses nothing under /reports", () => {
    const sources = [path.join(__dirname, "page.tsx"), path.join(__dirname, "calls/[id]/page.tsx")];
    for (const f of sources) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/reports/);
  });
});
