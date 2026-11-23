import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { sampleRows } from "@/demo-samples";
import { DemoCallBand } from "./DemoCallBand";
import { DEMO_PERSONAS } from "@/demo/personas";
import { DEMO_PROVIDERS } from "@/demo/providers";
import { busyMinutes, DEMO_CALL_WORDS as WORDS, formatElapsed, spelledName } from "./demoCallWords";

// A stand-in for the SDK's client: enough of an event emitter to drive call_started, call_ended and error without a microphone,
// a transport or the network. Defined in vi.hoisted because vi.mock's factory is hoisted above the imports.
const { FakeClient, clients } = vi.hoisted(() => {
  const clients: InstanceType<typeof FakeClient>[] = [];
  class FakeClient {
    static failStart = false;
    startCall = vi.fn(async () => {
      if (FakeClient.failStart) throw new Error("could not join");
    });
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

const CALL = { callId: "call_1", accessToken: "tok_1", transport: "gateway", iceServers: [] };
const ROW = sampleRows().find((r) => r.verdict === "failed")!;
const READY = { status: "ready", row: { ...ROW, callId: "call_1" } };

type Script = { status: number; body: unknown };
/** A fake server. `start` answers the POST; `results` is the script for the GET: each ask takes the next entry, the last one repeats. */
function fakeServer(opts: { start?: Script | (() => Promise<Response>); results?: Script[] } = {}) {
  const calls: { method: string; url: string }[] = [];
  const asks: number[] = [];
  const bodies: unknown[] = [];
  let ask = 0;
  const json = (s: Script) => new Response(JSON.stringify(s.body), { status: s.status });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      if (method === "POST" && url === "/api/demo-calls") {
        bodies.push(init?.body);
        const start = opts.start;
        if (typeof start === "function") return start();
        return json(start ?? { status: 200, body: CALL });
      }
      if (method === "GET" && url === "/api/demo-calls/call_1") {
        const script = opts.results ?? [{ status: 200, body: { status: "processing" } }];
        const entry = script[Math.min(ask, script.length - 1)];
        ask += 1;
        asks.push(Date.now());
        return json(entry);
      }
      throw new Error(`unexpected ${method} ${url}`);
    }),
  );
  return { calls, asks, bodies, asked: () => calls.filter((c) => c.method === "GET").length };
}

function mic(grant = true) {
  const getUserMedia = vi.fn(async () => {
    if (!grant) throw new DOMException("denied", "NotAllowedError");
    return { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  });
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return getUserMedia;
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const client = () => clients[clients.length - 1];
const connect = async () => {
  press(WORDS.call);
  await flush();
  act(() => {
    client().connected = true;
    client().emit("call_started");
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  clients.length = 0;
  FakeClient.failStart = false;
  mic();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the demo call band", () => {
  it("idle: names the first test patient, and lists the others under a details element in DEMO_PERSONAS order, without the excluded name", () => {
    const { container } = render(<DemoCallBand />);
    expect(screen.getByText("Call as a test patient: Aisha Rahman, born August 17, 1991. Spell it A, I, S, H, A, then R, A, H, M, A, N.")).toBeInTheDocument();
    const details = container.querySelector("details") as HTMLDetailsElement;
    expect(details.querySelector("summary")).toHaveTextContent("More test patients");
    const lines = Array.from(details.querySelectorAll("li")).map((li) => li.textContent);
    expect(lines).toEqual(["Marcus Bennett, born April 5, 1983", "Sofia Alvarez, born November 23, 1996", "Kenji Watanabe, born June 30, 1978"]);
    expect(within(details).getByText("The agent will ask you to spell the name.")).toBeInTheDocument();
    expect(DEMO_PERSONAS.map((p) => p.name)).toContain("Devanshu Chicholikar");
    const text = document.body.textContent ?? "";
    expect(text).not.toContain("Devanshu");
    expect(text.indexOf("Call as a test patient")).toBeLessThan(text.indexOf(WORDS.call));
  });


  it("idle: says what it is, with the call button, and the fine print under the button", () => {
    fakeServer();
    render(<DemoCallBand />);
    expect(screen.getByText("Try it on a call of your own.")).toHaveClass("font-semibold");
    expect(screen.getByText(WORDS.body)).toHaveClass("text-report-muted");
    const button = screen.getByRole("button", { name: "Call the demo agent" });
    expect(button).toHaveClass("bg-report-accent");
    expect(button).toBeEnabled();
    const fine = screen.getByText("Uses your microphone. Use a test patient, not your own details. Retell records calls on our demo account, and the demo clinic logs each request for a day. Overhear keeps your call in memory for an hour and shows it only to you.");
    expect(fine).toHaveClass("text-report-muted");
    expect(button.compareDocumentPosition(fine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe("idle: the Before you call block", () => {
    const DOCTORS = DEMO_PROVIDERS.map((p) => p.name);
    it("renders each fact, in order, between the body text and the call button", () => {
      fakeServer();
      render(<DemoCallBand />);
      const heading = screen.getByText("Before you call");
      expect(heading).toHaveClass("font-semibold");
      const list = heading.nextElementSibling as HTMLElement;
      expect(list).toHaveClass("text-report-muted");
      expect(list.className).not.toMatch(/shadow|rounded|bg-|border/);
      const own = Array.from(list.children).map((li) => Array.from(li.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(""));
      expect(own).toEqual([
        "Northwind Family Clinic is in New York. Appointment times are Eastern Time.",
        "Riley can check openings and book, move or cancel an appointment. She can\u2019t give medical advice or transfer calls.",
        `Doctors: ${DOCTORS.join(", ")}.`,
        "Call as a test patient: Aisha Rahman, born August 17, 1991. Spell it A, I, S, H, A, then R, A, H, M, A, N.",
        "Calls end after 5 minutes. After you hang up, Overhear checks your call in a few seconds.",
      ]);
      const body = screen.getByText(WORDS.body);
      const button = screen.getByRole("button", { name: WORDS.call });
      expect(body.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(heading.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(button.compareDocumentPosition(screen.getByText(/^Uses your microphone/)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("takes the doctors from the shared provider list the seed uses, not a second list", () => {
      expect(DOCTORS.length).toBeGreaterThan(0);
      fakeServer();
      render(<DemoCallBand />);
      for (const name of DOCTORS) expect(document.body.textContent).toContain(name);
    });

    it("derives the spelled form from the name", () => {
      expect(spelledName("Aisha Rahman")).toBe("A, I, S, H, A, then R, A, H, M, A, N");
      expect(spelledName("Kenji Watanabe")).toBe("K, E, N, J, I, then W, A, T, A, N, A, B, E");
      expect(spelledName("Mary-Jane O'Neil")).toBe("M, A, R, Y, J, A, N, E, then O, N, E, I, L");
      expect(spelledName("Cher")).toBe("C, H, E, R");
    });

    it("never shows the excluded name, and has no dashes", () => {
      fakeServer();
      render(<DemoCallBand />);
      expect(document.body.textContent).not.toMatch(/Devanshu|Chicholikar|D, E, V/);
      const words = [WORDS.beforeYouCall, WORDS.clinicZone, WORDS.whatRileyDoes, WORDS.doctors(DOCTORS), WORDS.callLimit, WORDS.duringCallClinic(DOCTORS), WORDS.firstPatient("Aisha Rahman", "x")];
      for (const w of words) expect(w).not.toMatch(/[\u2010-\u2015-]/);
    });
  });

  it("during the call (connecting, live, checking) one muted line gives Eastern Time and the doctors above the patients", async () => {
    fakeServer();
    render(<DemoCallBand />);
    const line = `Eastern Time. Doctors: ${DEMO_PROVIDERS.map((p) => p.name).join(", ")}.`;
    press(WORDS.call);
    await flush();
    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(screen.getByText(line).compareDocumentPosition(screen.getByText(WORDS.duringCall)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => {
      client().connected = true;
      client().emit("call_started");
    });
    expect(screen.getByText("On the call with the demo agent")).toBeInTheDocument();
    expect(screen.getByText(line)).toBeVisible();
    press("Hang up");
    expect(screen.getByText("Checking your call")).toBeInTheDocument();
    expect(screen.getByText(line)).toBeVisible();
  });

  it("sends the browser's time zone in the start request, and nothing else", async () => {
    const server = fakeServer();
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    expect(JSON.parse(String(server.bodies[0]))).toEqual({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  });

  it("is a band, not a card: a hairline above and below, no shadow", () => {
    fakeServer();
    render(<DemoCallBand />);
    const band = screen.getByRole("region");
    expect(band).toHaveClass("border-y", "border-report-line");
    expect(band.className).not.toMatch(/shadow|rounded|bg-/);
  });

  it("asks for the microphone first: the button is disabled and says to allow it, and no call is made yet", async () => {
    const server = fakeServer();
    let grant: (stream: MediaStream) => void = () => {};
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: () => new Promise<MediaStream>((resolve) => (grant = resolve)) },
      configurable: true,
    });
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    expect(screen.getByRole("button", { name: "Allow the microphone to start" })).toBeDisabled();
    expect(server.calls).toEqual([]);
    await act(async () => grant({ getTracks: () => [] } as unknown as MediaStream));
    expect(server.calls).toEqual([{ method: "POST", url: "/api/demo-calls" }]);
  });

  it("a blocked microphone says so and offers Try again; no call is made", async () => {
    const server = fakeServer();
    mic(false);
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    expect(screen.getByText("Your browser blocked the microphone. Allow it for this site, then try again.")).toBeInTheDocument();
    expect(server.calls).toEqual([]);
    mic(true);
    press("Try again");
    await flush();
    expect(server.calls.length).toBe(1);
  });

  it("a browser with no microphone API reads as blocked", async () => {
    fakeServer();
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    expect(screen.getByText(WORDS.micBlocked)).toBeInTheDocument();
  });

  it("says Connecting while the call is joining, and starts the SDK with the four fields only", async () => {
    fakeServer();
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(client().startCall).toHaveBeenCalledWith({ callId: "call_1", accessToken: "tok_1", transport: "gateway", iceServers: [] });
  });

  it("in the call: says who it is on with the time, which moves once a second, and offers Hang up", async () => {
    fakeServer();
    render(<DemoCallBand />);
    await connect();
    expect(screen.getByText("On the call with the demo agent")).toBeInTheDocument();
    expect(screen.getByLabelText(WORDS.elapsedLabel)).toHaveTextContent("0:00");
    await advance(1000);
    expect(screen.getByLabelText(WORDS.elapsedLabel)).toHaveTextContent("0:01");
    await advance(64_000);
    expect(screen.getByLabelText(WORDS.elapsedLabel)).toHaveTextContent("1:05");
    const hang = screen.getByRole("button", { name: "Hang up" });
    expect(hang).toHaveClass("border-report-critical", "text-report-critical");
    expect(hang).not.toHaveClass("bg-report-accent");
  });

  it("keeps every test patient on screen while connecting, during the call and while checking, so the caller can read them out", async () => {
    fakeServer();
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(screen.getByText(WORDS.duringCall)).toBeInTheDocument();
    act(() => {
      client().connected = true;
      client().emit("call_started");
    });
    expect(screen.getByText("On the call with the demo agent")).toBeInTheDocument();
    for (const name of ["Aisha Rahman, born August 17, 1991", "Marcus Bennett, born April 5, 1983", "Sofia Alvarez, born November 23, 1996", "Kenji Watanabe, born June 30, 1978"]) {
      expect(screen.getByText(name)).toBeVisible();
    }
    expect(screen.queryByText(/Chicholikar/)).toBeNull();
    press("Hang up");
    expect(screen.getByText("Checking your call")).toBeInTheDocument();
    expect(screen.getByText("Aisha Rahman, born August 17, 1991")).toBeVisible();
  });

  it("Hang up ends the call and goes on to Checking your call, with the spinner held back", async () => {
    fakeServer();
    render(<DemoCallBand />);
    await connect();
    press("Hang up");
    expect(client().stopCall).toHaveBeenCalled();
    expect(screen.getByText("Checking your call")).toBeInTheDocument();
    // The spinner comes in through the report-delayed class, which holds it back for 250 ms and fades it in over 150: about 400.
    expect(document.querySelector(".report-delayed")).toBeInTheDocument();
  });

  it("after the call, asks for the result every 3 seconds, never faster than every 2, and then shows Your call with the row", async () => {
    const server = fakeServer({ results: [{ status: 200, body: { status: "processing" } }, { status: 200, body: { status: "processing" } }, { status: 200, body: READY }] });
    render(<DemoCallBand />);
    await connect();
    press("Hang up");
    expect(server.asked()).toBe(0);
    await advance(3000);
    await advance(3000);
    await advance(3000);
    expect(server.asked()).toBe(3);
    for (let i = 1; i < server.asks.length; i++) expect(server.asks[i] - server.asks[i - 1]).toBeGreaterThanOrEqual(2000);
    expect(screen.getByText("Your call")).toBeInTheDocument();
    const row = document.querySelector('[data-call-id="call_1"]')!;
    expect(row).toHaveAttribute("data-state", "failed");
    expect(within(row as HTMLElement).getByRole("link")).toHaveAttribute("href", "/reports/call_1");
    expect(within(row as HTMLElement).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call again" })).toBeInTheDocument();
    // It stops asking once it has the answer.
    await advance(30_000);
    expect(server.asked()).toBe(3);
  });

  it("never asks faster than every 2 seconds even when told to", async () => {
    const server = fakeServer({ results: [{ status: 200, body: { status: "processing" } }, { status: 200, body: READY }] });
    render(<DemoCallBand pollMs={10} />);
    await connect();
    press("Hang up");
    await advance(1999);
    expect(server.asked()).toBe(0);
    await advance(1);
    expect(server.asked()).toBe(1);
  });

  it("Call again starts the next call at once", async () => {
    const server = fakeServer({ results: [{ status: 200, body: READY }] });
    render(<DemoCallBand />);
    await connect();
    press("Hang up");
    await advance(3000);
    press("Call again");
    await flush();
    expect(server.calls.filter((c) => c.method === "POST").length).toBe(2);
    expect(clients.length).toBe(2);
    expect(screen.getByText("Connecting")).toBeInTheDocument();
  });

  it("a call that never connects says so, with Try again", async () => {
    fakeServer();
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    act(() => client().emit("error"));
    expect(screen.getByText(WORDS.didNotConnect)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("an SDK that cannot start the call says it did not connect", async () => {
    fakeServer();
    FakeClient.failStart = true;
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    expect(screen.getByText(WORDS.didNotConnect)).toBeInTheDocument();
    expect(client().stopCall).toHaveBeenCalled();
  });

  it("the server saying the call did not connect gives the same sentence", async () => {
    fakeServer({ results: [{ status: 200, body: { status: "did_not_connect" } }] });
    render(<DemoCallBand />);
    await connect();
    press("Hang up");
    await advance(3000);
    expect(screen.getByText(WORDS.didNotConnect)).toBeInTheDocument();
  });

  it("after a timeout, Check again asks about the same call, and Call again starts a new one", async () => {
    const server = fakeServer({ results: [{ status: 200, body: { status: "timeout" } }, { status: 200, body: READY }] });
    render(<DemoCallBand />);
    await connect();
    press("Hang up");
    await advance(3000);
    expect(screen.getByText(WORDS.timeout)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Call again" })).toBeInTheDocument();
    press("Check again");
    expect(screen.getByText("Checking your call")).toBeInTheDocument();
    await advance(3000);
    expect(server.calls.filter((c) => c.method === "GET").map((c) => c.url)).toEqual(["/api/demo-calls/call_1", "/api/demo-calls/call_1"]);
    expect(server.calls.filter((c) => c.method === "POST").length).toBe(1);
    expect(screen.getByRole("heading", { name: "Your call" })).toBeInTheDocument();
  });

  it("after a timeout, Call again starts a new call", async () => {
    const server = fakeServer({ results: [{ status: 200, body: { status: "timeout" } }] });
    render(<DemoCallBand />);
    await connect();
    press("Hang up");
    await advance(3000);
    press("Call again");
    await flush();
    expect(server.calls.filter((c) => c.method === "POST").length).toBe(2);
  });

  it("rate limited: says how many minutes, with Try again", async () => {
    fakeServer({ start: { status: 429, body: { error: "rate_limited", message: "x", retryAfter: 421 } } });
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    expect(screen.getByText("The demo is busy. Try again in 8 minutes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(clients.length).toBe(0);
  });

  it("a server error on start says a fixed sentence, not the server's words", async () => {
    fakeServer({ start: { status: 500, body: { error: "failed", message: "Retell said something private" } } });
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    expect(screen.getByText(WORDS.error)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("private");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("a network failure on start says the same sentence", async () => {
    fakeServer({ start: () => Promise.reject(new TypeError("network")) });
    render(<DemoCallBand />);
    press(WORDS.call);
    await flush();
    expect(screen.getByText(WORDS.error)).toBeInTheDocument();
  });

  it("gives up after three failed asks for the result, in a fixed sentence", async () => {
    const server = fakeServer({ results: [{ status: 502, body: { error: "unavailable", message: "x" } }] });
    render(<DemoCallBand />);
    await connect();
    press("Hang up");
    await advance(3000);
    await advance(6000);
    await advance(12_000);
    expect(server.asked()).toBe(3);
    expect(screen.getByText(WORDS.error)).toBeInTheDocument();
  });

  it("a 404 for the result ends the wait at once", async () => {
    const server = fakeServer({ results: [{ status: 404, body: { error: "not_found", message: "x" } }] });
    render(<DemoCallBand />);
    await connect();
    press("Hang up");
    await advance(3000);
    expect(server.asked()).toBe(1);
    expect(screen.getByText(WORDS.error)).toBeInTheDocument();
  });

  it("two quick clicks make one call", async () => {
    const server = fakeServer();
    render(<DemoCallBand />);
    const button = screen.getByRole("button", { name: WORDS.call });
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();
    expect(server.calls.filter((c) => c.method === "POST").length).toBe(1);
  });

  it("lets go of the call when the page goes away", async () => {
    fakeServer();
    const view = render(<DemoCallBand />);
    await connect();
    view.unmount();
    expect(client().stopCall).toHaveBeenCalled();
    expect(client().removeAllListeners).toHaveBeenCalled();
  });

  it("says nothing with a dash, an exclamation mark or a straight apostrophe", () => {
    const texts = Object.values(WORDS).flatMap((w) => {
      if (typeof w === "string") return [w];
      const say = w as (...args: unknown[]) => string;
      if (w.length === 2) return [say("Ann Lee", "May 1, 2000")];
      // One-argument phrases take a number (busy) or a list of names (doctors).
      return [1, 2, ["Dr. Ann Lee", "Dr. Bo Kim"]].flatMap((arg) => {
        try {
          return [say(arg)];
        } catch {
          return [];
        }
      });
    });
    for (const text of texts) {
      expect(text).not.toMatch(/[—–!']/);
      expect(text).not.toMatch(/ - /);
    }
  });
});

describe("the helpers", () => {
  it("formats time as m:ss", () => {
    expect([0, 9, 60, 65, 600].map(formatElapsed)).toEqual(["0:00", "0:09", "1:00", "1:05", "10:00"]);
  });
  it("rounds the wait up to whole minutes, at least one", () => {
    expect([0, 1, 60, 61, 421, undefined, "x"].map(busyMinutes)).toEqual([1, 1, 1, 2, 8, 1, 1]);
  });
});
