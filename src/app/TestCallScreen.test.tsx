import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TEST_CALL_DID_NOT_CONNECT_MESSAGE, TEST_CALL_MESSAGE, TEST_CALL_TIMEOUT_MESSAGE } from "@/pull/labels";
import { answerOf } from "@/components/report/answer";
import { KEEP_WORDS } from "@/report/labels";
import { NO_CONTENT_LINE } from "@/report/labels";
import { failedSample } from "@/report/samples";
import { TestCallScreen } from "./TestCallScreen";
import { TEST_WORDS } from "./testCallWords";

// A stand-in for the SDK's client: enough of an event emitter to drive call_started, update, call_ended and error without a
// microphone, a transport or the network. Defined in vi.hoisted because vi.mock's factory is hoisted above the imports.
const { FakeClient, clients } = vi.hoisted(() => {
  const clients: InstanceType<typeof FakeClient>[] = [];
  class FakeClient {
    startCall = vi.fn().mockResolvedValue(undefined);
    stopCall = vi.fn(() => {
      if (this.connected) this.emit("call_ended");
      this.connected = false;
    });
    removeAllListeners = vi.fn();
    connected = false;
    private listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    constructor() {
      clients.push(this);
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const handler of this.listeners.get(event) ?? []) handler(...args);
    }
  }
  return { FakeClient, clients };
});
vi.mock("retell-client-js-sdk", () => ({ RetellWebClient: FakeClient }));

const AGENTS = [
  { id: "agent_aaa111", name: "Northwind front desk" },
  { id: "agent_bbb222", name: "Northwind after hours" },
];
const CALL = { callId: "call_1", accessToken: "tok_1", transport: "gateway", iceServers: [] };

type Refusal = { error: string; message: string; httpStatus: number };
type Result = Record<string, unknown> | Refusal;
const isRefusal = (r: Result): r is Refusal => typeof (r as Refusal).httpStatus === "number";

/** A fake local server. `results` is the script for the result route: each ask takes the next entry, the last one repeats. */
function fakeServer(opts: { agents?: unknown; agentsStatus?: number; start?: Response | (() => Response); results?: Result[] } = {}) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const asks: number[] = [];
  let ask = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    if (method === "GET" && url === "/api/agents") return json(opts.agents ?? { agents: AGENTS }, opts.agentsStatus ?? 200);
    if (method === "POST" && url === "/api/test-calls") {
      const start = opts.start;
      return typeof start === "function" ? start() : (start?.clone() ?? json(CALL));
    }
    if (method === "GET" && url === "/api/test-calls/call_1/result") {
      const script = opts.results ?? [{ status: "processing" }];
      const entry = script[Math.min(ask, script.length - 1)];
      ask += 1;
      asks.push(Date.now());
      if (isRefusal(entry)) return json({ error: entry.error, message: entry.message }, entry.httpStatus);
      return json(entry);
    }
    if (method === "GET" && url === "/api/pins") return json({ pins: [], problems: [] });
    throw new Error(`unexpected ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const asked = () => calls.filter((c) => c.url === "/api/test-calls/call_1/result").length;
  return { calls, asked, asks };
}

function allowMic(grant = true) {
  const stop = vi.fn();
  const getUserMedia = vi.fn(async () => {
    if (!grant) throw new DOMException("denied", "NotAllowedError");
    return { getTracks: () => [{ stop }] } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return { getUserMedia, stop };
}

const client = () => {
  const c = clients[clients.length - 1];
  if (!c) throw new Error("no client was made");
  return c;
};
const update = (transcript: { role: string; content: string }[]) => act(() => client().emit("update", { event_type: "update", transcript }));

async function pickAgent(id = AGENTS[0].id) {
  // Testing Library's waiting does not know vitest's fake timers, so under them the agents are already there.
  const select = vi.isFakeTimers() ? screen.getByLabelText(TEST_WORDS.agentLabel) : await screen.findByLabelText(TEST_WORDS.agentLabel);
  fireEvent.change(select, { target: { value: id } });
}

/** Picks the first agent, starts, and waits until the call is live. */
async function goLive() {
  await pickAgent();
  fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.start }));
  await waitFor(() => expect(clients.length).toBe(1));
  await waitFor(() => expect(client().startCall).toHaveBeenCalled());
  act(() => {
    client().connected = true;
    client().emit("call_started");
  });
  await screen.findByRole("button", { name: TEST_WORDS.end });
}

const hangUp = () => act(() => client().stopCall());

beforeEach(() => {
  clients.length = 0;
  allowMic();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the agent picker", () => {
  it("lists the agents by name and id, says what a test call costs, and starts only once an agent is chosen", async () => {
    fakeServer();
    render(<TestCallScreen />);
    expect(screen.getByText(TEST_WORDS.agentsLoading)).toBeInTheDocument();
    const select = await screen.findByLabelText(TEST_WORDS.agentLabel);
    expect(within(select).getByRole("option", { name: "Northwind front desk (agent_aaa111)" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Northwind after hours (agent_bbb222)" })).toBeInTheDocument();
    expect(screen.getByText(TEST_WORDS.cost)).toBeInTheDocument();
    expect(screen.getByText(TEST_WORDS.micNote)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TEST_WORDS.start })).toBeDisabled();
    fireEvent.change(select, { target: { value: "agent_aaa111" } });
    expect(screen.getByRole("button", { name: TEST_WORDS.start })).toBeEnabled();
  });

  it("chooses the only agent for you", async () => {
    fakeServer({ agents: { agents: [AGENTS[0]] } });
    render(<TestCallScreen />);
    await waitFor(() => expect(screen.getByRole("button", { name: TEST_WORDS.start })).toBeEnabled());
  });

  it("says there are no voice agents, and checks again on request", async () => {
    const server = fakeServer({ agents: { agents: [] } });
    render(<TestCallScreen />);
    expect(await screen.findByText(TEST_WORDS.agentsEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: TEST_WORDS.start })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.checkAgain }));
    await waitFor(() => expect(server.calls.filter((c) => c.url === "/api/agents")).toHaveLength(2));
  });

  it("shows the server's words when the agents cannot be listed", async () => {
    fakeServer({ agents: { error: "bad_key", message: TEST_CALL_MESSAGE.bad_key }, agentsStatus: 502 });
    render(<TestCallScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent(TEST_CALL_MESSAGE.bad_key);
    expect(screen.getByRole("button", { name: TEST_WORDS.tryAgain })).toBeInTheDocument();
  });

  it("says Overhear did not answer when the list cannot be asked for", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("down"))));
    render(<TestCallScreen />);
    expect(await screen.findByRole("alert")).toHaveTextContent(TEST_WORDS.unreachable);
  });
});

describe("starting a call", () => {
  it("asks for the microphone, starts the call for the chosen agent, and joins with the fields the server gave", async () => {
    const mic = allowMic();
    const server = fakeServer();
    render(<TestCallScreen />);
    await pickAgent("agent_bbb222");
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.start }));
    await waitFor(() => expect(client().startCall).toHaveBeenCalled());
    expect(mic.getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(mic.stop).toHaveBeenCalled();
    expect(server.calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/test-calls", body: { agentId: "agent_bbb222" } });
    expect(client().startCall).toHaveBeenCalledWith({ accessToken: "tok_1", callId: "call_1", transport: "gateway", iceServers: [] });
  });

  it("shows the microphone and connection states from asking to live", async () => {
    fakeServer();
    render(<TestCallScreen />);
    await pickAgent();
    const fact = (label: string) => screen.getByText(label).parentElement as HTMLElement;
    expect(screen.queryByText(TEST_WORDS.factMic)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.start }));
    await waitFor(() => expect(client().startCall).toHaveBeenCalled());
    expect(fact(TEST_WORDS.factMic)).toHaveTextContent(TEST_WORDS.mic.allowed);
    expect(fact(TEST_WORDS.factConnection)).toHaveTextContent(TEST_WORDS.connection.connecting);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.connectingLead);
    act(() => {
      client().connected = true;
      client().emit("call_started");
    });
    expect(fact(TEST_WORDS.factMic)).toHaveTextContent(TEST_WORDS.mic.on);
    expect(fact(TEST_WORDS.factConnection)).toHaveTextContent(TEST_WORDS.connection.connected);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.liveLead);
    expect(fact(TEST_WORDS.factAgent)).toHaveTextContent("Northwind front desk");
  });

  it("says so when the microphone is blocked, and makes no call", async () => {
    allowMic(false);
    const server = fakeServer();
    render(<TestCallScreen />);
    await pickAgent();
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.start }));
    expect(await screen.findByRole("alert")).toHaveTextContent(TEST_WORDS.micBlocked);
    expect(server.calls.some((c) => c.method === "POST")).toBe(false);
    expect(clients).toHaveLength(0);
    expect(screen.getByText(TEST_WORDS.factMic).parentElement).toHaveTextContent(TEST_WORDS.mic.blocked);
    expect(screen.getByRole("button", { name: TEST_WORDS.start })).toBeEnabled();
  });

  it("says so when the browser has no microphone to share", async () => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    fakeServer();
    render(<TestCallScreen />);
    await pickAgent();
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.start }));
    expect(await screen.findByRole("alert")).toHaveTextContent(TEST_WORDS.micMissing);
  });

  it("shows the server's words when a test call is already running (409), and starts nothing", async () => {
    fakeServer({ start: new Response(JSON.stringify({ error: "call_active", message: TEST_CALL_MESSAGE.call_active }), { status: 409 }) });
    render(<TestCallScreen />);
    await pickAgent();
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.start }));
    expect(await screen.findByRole("alert")).toHaveTextContent(TEST_CALL_MESSAGE.call_active);
    expect(clients).toHaveLength(0);
    expect(screen.getByRole("button", { name: TEST_WORDS.start })).toBeEnabled();
  });

  it("says Overhear did not answer when the start cannot be made", async () => {
    fakeServer({
      start: () => {
        throw new TypeError("down");
      },
    });
    render(<TestCallScreen />);
    await pickAgent();
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.start }));
    expect(await screen.findByRole("alert")).toHaveTextContent(TEST_WORDS.unreachable);
  });
});

describe("the live transcript", () => {
  it("shows each turn as it arrives, agent and caller, and keeps the whole call", async () => {
    fakeServer();
    render(<TestCallScreen />);
    await goLive();
    const log = screen.getByRole("log", { name: TEST_WORDS.transcriptLive });
    expect(log).toHaveTextContent(TEST_WORDS.transcriptWaiting);
    await update([{ role: "agent", content: "Thanks for calling Northwind. How can I help?" }]);
    expect(log).toHaveTextContent("Agent");
    expect(log).toHaveTextContent("Thanks for calling Northwind. How can I help?");
    await update([
      { role: "agent", content: "Thanks for calling Northwind. How can I help?" },
      { role: "user", content: "I need to see Dr. Nayar on Friday." },
    ]);
    const turns = within(log).getAllByRole("listitem");
    expect(turns).toHaveLength(2);
    expect(turns[0]).toHaveTextContent(`${TEST_WORDS.agentTurn}Thanks for calling Northwind. How can I help?`);
    expect(turns[1]).toHaveTextContent(`${TEST_WORDS.callerTurn}I need to see Dr. Nayar on Friday.`);
    expect(log).not.toHaveTextContent(TEST_WORDS.transcriptWaiting);
  });

  it("updates a turn in place as the words firm up", async () => {
    fakeServer();
    render(<TestCallScreen />);
    await goLive();
    await update([{ role: "user", content: "I need to see Dr" }]);
    await update([{ role: "user", content: "I need to see Dr. Nayar" }]);
    const turns = within(screen.getByRole("log")).getAllByRole("listitem");
    expect(turns).toHaveLength(1);
    expect(turns[0]).toHaveTextContent("I need to see Dr. Nayar");
  });

  it("ignores an update that is not a transcript", async () => {
    fakeServer();
    render(<TestCallScreen />);
    await goLive();
    await update([{ role: "agent", content: "Hello." }]);
    act(() => client().emit("update", { event_type: "update" }));
    act(() => client().emit("update", "nonsense"));
    expect(within(screen.getByRole("log")).getAllByRole("listitem")).toHaveLength(1);
  });
});

describe("after the call", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  async function liveWithFakeTimers() {
    await tick(0);
    await pickAgent();
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.start }));
    await tick(0);
    expect(client().startCall).toHaveBeenCalled();
    act(() => {
      client().connected = true;
      client().emit("call_started");
    });
  }

  it("does not ask for the result while the call is live, and starts only after call_ended", async () => {
    const server = fakeServer({ results: [{ status: "processing" }] });
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    await tick(20_000);
    expect(server.asked()).toBe(0);
    hangUp();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.processingLead);
    expect(server.asked()).toBe(0);
    await tick(2_900);
    expect(server.asked()).toBe(0);
    await tick(200);
    expect(server.asked()).toBe(1);
    await tick(3_000);
    expect(server.asked()).toBe(2);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.processingLead);
  });

  it("never asks faster than every 2 seconds, however fast it is told to", async () => {
    const server = fakeServer({ results: [{ status: "processing" }] });
    render(<TestCallScreen pollMs={100} />);
    await liveWithFakeTimers();
    hangUp();
    await tick(1_900);
    expect(server.asked()).toBe(0);
    await tick(200);
    expect(server.asked()).toBe(1);
    await tick(1_700);
    expect(server.asked()).toBe(1);
    await tick(300);
    expect(server.asked()).toBe(2);
  });

  it("stops asking once the report is ready, and shows it next to the transcript that was seen", async () => {
    const server = fakeServer({ results: [{ status: "processing" }, { status: "ready", outcome: { kind: "report", report: failedSample } }] });
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    await update([
      { role: "agent", content: "Transferring you to a nurse now." },
      { role: "user", content: "Thank you." },
    ]);
    hangUp();
    await tick(3_000);
    await tick(3_000);
    expect(server.asked()).toBe(2);
    await tick(30_000);
    expect(server.asked()).toBe(2);
    const lead = answerOf(failedSample)!.text;
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(lead);
    const log = screen.getByRole("log", { name: TEST_WORDS.transcriptSaw });
    expect(within(log).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(TEST_WORDS.transcriptFinalRecord)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: KEEP_WORDS.open })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: TEST_WORDS.another })).toBeInTheDocument();
  });

  it("says the call did not connect in the server's words, and stops asking", async () => {
    const server = fakeServer({ results: [{ status: "did_not_connect", message: TEST_CALL_DID_NOT_CONNECT_MESSAGE }] });
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    hangUp();
    await tick(3_000);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.noReportLead);
    expect(screen.getByText(TEST_CALL_DID_NOT_CONNECT_MESSAGE)).toBeInTheDocument();
    await tick(20_000);
    expect(server.asked()).toBe(1);
    expect(screen.queryByText(TEST_WORDS.processingLead)).toBeNull();
  });

  it("says Retell is taking longer than usual in the server's words, and stops asking", async () => {
    const server = fakeServer({ results: [{ status: "timeout", message: TEST_CALL_TIMEOUT_MESSAGE }] });
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    hangUp();
    await tick(3_000);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.timeoutLead);
    expect(screen.getByText(TEST_CALL_TIMEOUT_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: TEST_WORDS.allCalls })).toHaveAttribute("href", "/");
    await tick(20_000);
    expect(server.asked()).toBe(1);
  });

  it("says why a call with no transcript has nothing to check", async () => {
    fakeServer({ results: [{ status: "ready", outcome: { kind: "no_content", callId: "call_1", reason: "no_transcript" } }] });
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    hangUp();
    await tick(3_000);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.noContentLead);
    expect(screen.getByText(NO_CONTENT_LINE.no_transcript)).toBeInTheDocument();
  });

  it("says Overhear could not check a call it could not read, in the engine's own message", async () => {
    fakeServer({ results: [{ status: "ready", outcome: { kind: "error", callId: "call_1", message: "Could not check this call." } }] });
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    hangUp();
    await tick(3_000);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.errorLead);
    expect(screen.getByText("Could not check this call.")).toBeInTheDocument();
  });

  it("does not show a report that fails the schema", async () => {
    fakeServer({ results: [{ status: "ready", outcome: { kind: "report", report: { callId: "call_1" } } }] });
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    hangUp();
    await tick(3_000);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.errorLead);
    expect(screen.queryByRole("button", { name: KEEP_WORDS.open })).toBeNull();
  });

  it("keeps asking through a pause from Retell, saying what happened", async () => {
    const server = fakeServer({
      results: [{ error: "rate_limited", message: TEST_CALL_MESSAGE.rate_limited, httpStatus: 429 }, { status: "ready", outcome: { kind: "no_content", callId: "call_1", reason: "no_transcript" } }],
    });
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    hangUp();
    await tick(3_000);
    expect(screen.getByRole("status")).toHaveTextContent(TEST_CALL_MESSAGE.rate_limited);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.processingLead);
    await tick(3_000);
    expect(server.asked()).toBe(2);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.noContentLead);
  });

  it("stops asking and says why when the server refuses for good", async () => {
    const server = fakeServer({ results: [{ error: "not_found", message: TEST_CALL_MESSAGE.not_found, httpStatus: 404 }] });
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    hangUp();
    await tick(3_000);
    expect(screen.getByRole("alert")).toHaveTextContent(TEST_CALL_MESSAGE.not_found);
    await tick(20_000);
    expect(server.asked()).toBe(1);
  });

  it("keeps asking when Overhear cannot be reached for a moment", async () => {
    let calls = 0;
    const server = fakeServer({ results: [{ status: "processing" }] });
    const inner = global.fetch as typeof fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/result") && calls++ === 0) throw new TypeError("down");
      return inner(input, init);
    }));
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    hangUp();
    await tick(3_000);
    expect(screen.getByRole("status")).toHaveTextContent(TEST_WORDS.unreachable);
    await tick(3_000);
    expect(server.asked()).toBe(1);
    expect(screen.getByRole("status")).not.toHaveTextContent(TEST_WORDS.unreachable);
  });

  it("asks for the result when the connection fails before the call starts, and says so", async () => {
    const server = fakeServer({ results: [{ status: "did_not_connect", message: TEST_CALL_DID_NOT_CONNECT_MESSAGE }] });
    render(<TestCallScreen />);
    await tick(0);
    await pickAgent();
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.start }));
    await tick(0);
    act(() => client().emit("error", "Error starting call"));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.couldntConnectLead);
    expect(screen.getByRole("alert")).toHaveTextContent(TEST_WORDS.connectionFailed);
    expect(screen.getByText(TEST_WORDS.factConnection).parentElement).toHaveTextContent(TEST_WORDS.connection.failed);
    await tick(3_000);
    expect(server.asked()).toBe(1);
    expect(screen.getByText(TEST_CALL_DID_NOT_CONNECT_MESSAGE)).toBeInTheDocument();
  });

  it("ends the call from the End button, and then waits for Retell", async () => {
    fakeServer();
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.end }));
    expect(client().stopCall).toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.processingLead);
    expect(screen.getByText(TEST_WORDS.factMic).parentElement).toHaveTextContent(TEST_WORDS.mic.off);
    expect(screen.getByText(TEST_WORDS.factConnection).parentElement).toHaveTextContent(TEST_WORDS.connection.ended);
  });

  it("stops the call and the asking when the screen goes away", async () => {
    const server = fakeServer();
    const { unmount } = render(<TestCallScreen />);
    await liveWithFakeTimers();
    hangUp();
    await tick(3_000);
    expect(server.asked()).toBe(1);
    unmount();
    await tick(20_000);
    expect(server.asked()).toBe(1);
  });

  it("stops a live call when the screen goes away", async () => {
    fakeServer();
    const { unmount } = render(<TestCallScreen />);
    await liveWithFakeTimers();
    unmount();
    expect(client().stopCall).toHaveBeenCalled();
  });

  it("starts over from Start another test call, with the agent still chosen and the old call gone", async () => {
    fakeServer({ results: [{ status: "ready", outcome: { kind: "no_content", callId: "call_1", reason: "no_transcript" } }] });
    render(<TestCallScreen />);
    await liveWithFakeTimers();
    await update([{ role: "agent", content: "Hello." }]);
    hangUp();
    await tick(3_000);
    fireEvent.click(screen.getByRole("button", { name: TEST_WORDS.another }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(TEST_WORDS.idleLead);
    expect(screen.queryByText("Hello.")).toBeNull();
    expect((screen.getByLabelText(TEST_WORDS.agentLabel) as HTMLSelectElement).value).toBe("agent_aaa111");
    expect(screen.getByRole("button", { name: TEST_WORDS.start })).toBeEnabled();
  });
});
