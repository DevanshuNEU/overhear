import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";

// A fake stand-in for the SDK's deprecated-but-supported 2.x client: enough
// of an EventEmitter to let the test drive call_started / call_ended / error
// without touching a real WebRTC transport or the network. Defined inside
// vi.hoisted because vi.mock's factory is hoisted above these imports.
const { FakeRetellWebClient, instances } = vi.hoisted(() => {
  const instances: InstanceType<typeof FakeRetellWebClient>[] = [];

  class FakeRetellWebClient {
    startCall = vi.fn().mockResolvedValue(undefined);
    stopCall = vi.fn();
    private listeners = new Map<string, ((...args: unknown[]) => void)[]>();

    constructor() {
      instances.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void) {
      const handlers = this.listeners.get(event) ?? [];
      handlers.push(handler);
      this.listeners.set(event, handlers);
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      for (const handler of this.listeners.get(event) ?? []) handler(...args);
    }
  }

  return { FakeRetellWebClient, instances };
});

vi.mock("retell-client-js-sdk", () => ({
  RetellWebClient: FakeRetellWebClient,
}));

import { WebCallWidget } from "./WebCallWidget";

function latestClient(): InstanceType<typeof FakeRetellWebClient> {
  const client = instances[instances.length - 1];
  if (!client) throw new Error("no RetellWebClient instance was created");
  return client;
}

beforeEach(() => {
  instances.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accessToken: "tok", callId: "c1" }),
    }),
  );
});

describe("WebCallWidget", () => {
  it("shows the idle button and a microphone-access note", () => {
    render(<WebCallWidget />);
    expect(screen.getByRole("button", { name: "Talk to the scheduling agent" })).toBeInTheDocument();
    expect(screen.getByText(/microphone access/i)).toBeInTheDocument();
  });

  it("fetches a token, starts the call with it, and shows connecting then live", async () => {
    render(<WebCallWidget />);

    fireEvent.click(screen.getByRole("button", { name: "Talk to the scheduling agent" }));

    expect(screen.getByRole("button", { name: "Connecting..." })).toBeDisabled();

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith("/api/web-call", { method: "POST" }));
    await waitFor(() => expect(latestClient().startCall).toHaveBeenCalledWith({ accessToken: "tok" }));

    act(() => latestClient().emit("call_started"));

    expect(screen.getByRole("button", { name: "Hang up" })).toBeInTheDocument();
    expect(screen.getByText(/live/i)).toBeInTheDocument();
  });

  it("stops the call and reflects the ended state when hanging up", async () => {
    render(<WebCallWidget />);

    fireEvent.click(screen.getByRole("button", { name: "Talk to the scheduling agent" }));
    await waitFor(() => expect(latestClient().startCall).toHaveBeenCalled());
    act(() => latestClient().emit("call_started"));

    fireEvent.click(screen.getByRole("button", { name: "Hang up" }));
    expect(latestClient().stopCall).toHaveBeenCalled();

    act(() => latestClient().emit("call_ended"));

    expect(screen.getByRole("button", { name: "Talk to the scheduling agent" })).toBeInTheDocument();
    expect(screen.getByText(/call ended/i)).toBeInTheDocument();
  });

  it("shows an error state when the SDK reports an error", async () => {
    render(<WebCallWidget />);

    fireEvent.click(screen.getByRole("button", { name: "Talk to the scheduling agent" }));
    await waitFor(() => expect(latestClient().startCall).toHaveBeenCalled());

    act(() => latestClient().emit("error", "microphone permission denied"));

    expect(screen.getByText(/microphone permission denied/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Talk to the scheduling agent" })).toBeInTheDocument();
  });

  it("shows an error state when the token request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }),
    );

    render(<WebCallWidget />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to the scheduling agent" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Talk to the scheduling agent" })).toBeInTheDocument());
    expect(screen.getByText(/could not start the call/i)).toBeInTheDocument();
  });
});
