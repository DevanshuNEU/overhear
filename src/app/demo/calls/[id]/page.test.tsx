// The demo call page, now at /demo/calls/[id], renders as it did at /calls/[id], and "Back to calls" returns to /demo.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { CallDetail } from "@/qa/queries";

const call: CallDetail = {
  id: "call_demo_1",
  status: "scored",
  composite: 0.5,
  failureCategories: [],
  retellSentiment: "Neutral",
  scoredAt: "2026-11-05T10:00:00.000Z",
  startedAt: "2026-11-05T09:58:00.000Z",
  transcript: [
    { role: "agent", content: "Hello, how can I help?", words: [] },
    { role: "user", content: "I want to book a visit.", words: [] },
  ],
  summary: "The caller asked to book a visit.",
  dimensions: [
    { key: "task_success", tier: "objective", score: 1, passed: true, confidence: null, rationale: "Booked." },
  ],
  judgeSource: "claude",
  retellSummary: null,
};

const getCall = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ db: {} }));
vi.mock("@/qa/queries", () => ({ getCall, scoreTrend: vi.fn(async () => []) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("/demo/calls/[id]", () => {
  it("renders the call with its summary and transcript, and links back to /demo", async () => {
    getCall.mockResolvedValue(call);
    const { default: CallDetailPage, dynamic } = await import("./page");
    expect(dynamic).toBe("force-dynamic");
    render(await CallDetailPage({ params: Promise.resolve({ id: "call_demo_1" }) }));

    expect(getCall).toHaveBeenCalledWith(expect.anything(), "call_demo_1");
    expect(screen.getByRole("heading", { level: 1, name: "call_demo_1" })).toBeInTheDocument();
    expect(screen.getByText("The caller asked to book a visit.")).toBeInTheDocument();
    expect(screen.getByText("Hello, how can I help?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to calls" })).toHaveAttribute("href", "/demo");
  });

  it("links back to /demo when the call does not exist", async () => {
    getCall.mockResolvedValue(null);
    const { default: CallDetailPage } = await import("./page");
    render(await CallDetailPage({ params: Promise.resolve({ id: "missing" }) }));

    expect(screen.getByText("No call found with this id.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to calls" })).toHaveAttribute("href", "/demo");
  });
});
