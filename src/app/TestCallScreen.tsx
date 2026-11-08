"use client";

// The test call screen (local mode only): pick one of your agents, talk to it from the browser, read the transcript as it
// arrives, and, after you hang up, see the report next to the transcript you saw.
//
// The key never reaches this file. The server lists the agents (GET /api/agents), starts the call (POST /api/test-calls, which
// answers only the fields the browser needs to join) and answers where the call stands (GET /api/test-calls/{id}/result).
// The words for every refusal come from the server and are shown as they arrive.
//
// The order of a call:
//   1. The microphone is asked for first. A blocked microphone stops here: no call is made, so no minutes are spent and the
//      server's one-call slot is never taken.
//   2. The server starts the call and the SDK's client joins it. `update` events carry the whole transcript so far; the screen
//      shows the latest one. Nothing is written anywhere: the transcript lives in this tab.
//   3. Only after a call that connected has ended (call_ended) does the screen ask for the result, every 3 seconds and
//      never faster than every 2. It stops on ready, did_not_connect, timeout or a refusal that will not change. A call that
//      never connected (the SDK failed to join, the person ended it first, or left the screen) has nothing to wait for: the
//      screen tells the server (POST /api/test-calls/{id}/release) to free its one-call slot, so starting again is not a 409.
//   4. The report is the engine's, from Retell's final record. The live transcript is for reading while talking: the two can
//      differ slightly, and the screen says so.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { RetellWebClient } from "retell-client-js-sdk";
import { BackLink } from "@/components/report/BackLink";
import { CallReportView } from "@/components/report/CallReportView";
import { NO_CONTENT_LINE, NO_CONTENT_REASONS, type NoContentReason } from "@/report/labels";
import { CallReportSchema, type CallReport } from "@/report/schema";
import { CONNECT_WORDS } from "./ConnectScreen";
import { TEST_WORDS, type ConnectionState, type MicState } from "./testCallWords";

/** The least time between two asks for a result. A caller's own setting can slow this down, never speed it up. */
const MIN_POLL_MS = 2000;
const DEFAULT_POLL_MS = 3000;
/** How far from the bottom of the transcript still counts as being at it. */
const NEAR_BOTTOM_PX = 40;
/** The longest wait between asks while Retell is limiting or failing. */
const MAX_POLL_MS = 15000;
/** Answers that pass: Retell is limiting requests or having trouble, so the screen says so and asks again. */
const TRANSIENT = new Set(["rate_limited", "network", "retell_down"]);
const JSON_HEADERS = { "content-type": "application/json" };

type Agent = { id: string; name: string };
type Agents = { kind: "loading" } | { kind: "ready"; list: Agent[] } | { kind: "failed"; message: string };
type Turn = { role: "agent" | "caller"; text: string };
type Phase = "idle" | "connecting" | "live" | "ended";
type Outcome =
  | { kind: "report"; report: CallReport }
  | { kind: "no_content"; message: string }
  | { kind: "problem"; message: string }
  | { kind: "did_not_connect"; message: string }
  | { kind: "timeout"; message: string }
  | { kind: "refused"; message: string };
type Client = Pick<RetellWebClient, "on" | "startCall" | "stopCall" | "removeAllListeners">;
type Config = Parameters<RetellWebClient["startCall"]>[0];

type Props = {
  /** Milliseconds between asks for the result once the call has ended. Never less than 2000. */
  pollMs?: number;
  /** A scripted client may stand in for the SDK's (the preview states used for screenshots; see the page). */
  stubbable?: boolean;
};

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The agent's id, name and nothing else, from the list route. Anything else is left out. */
function agentsOf(body: unknown): Agent[] | null {
  if (!isRec(body) || !Array.isArray(body.agents)) return null;
  return body.agents.flatMap((a) => (isRec(a) && typeof a.id === "string" && typeof a.name === "string" ? [{ id: a.id, name: a.name }] : []));
}

/** The turns an `update` event carries. Anything that is not a transcript is null, so the screen keeps what it has. */
function turnsOf(event: unknown): Turn[] | null {
  if (!isRec(event) || !Array.isArray(event.transcript)) return null;
  return event.transcript.flatMap((u): Turn[] => {
    if (!isRec(u) || typeof u.content !== "string") return [];
    if (u.role === "agent") return [{ role: "agent", text: u.content }];
    if (u.role === "user") return [{ role: "caller", text: u.content }];
    return [];
  });
}

/** What a result says, or null while Retell is still processing. */
function outcomeOf(body: Record<string, unknown>): Outcome | null {
  const message = typeof body.message === "string" ? body.message : "";
  if (body.status === "did_not_connect") return { kind: "did_not_connect", message };
  if (body.status === "timeout") return { kind: "timeout", message };
  if (body.status !== "ready") return null;
  const o = body.outcome;
  if (isRec(o) && o.kind === "report") {
    const parsed = CallReportSchema.safeParse(o.report);
    // A report that does not validate is never shown.
    return parsed.success ? { kind: "report", report: parsed.data } : { kind: "problem", message: "" };
  }
  if (isRec(o) && o.kind === "no_content") {
    const reason = NO_CONTENT_REASONS.find((r): r is NoContentReason => r === o.reason);
    return { kind: "no_content", message: reason ? NO_CONTENT_LINE[reason] : NO_CONTENT_LINE.no_transcript };
  }
  return { kind: "problem", message: isRec(o) && typeof o.message === "string" ? o.message : "" };
}

/**
 * Tells the server a call it started never connected, so it frees its one-call slot. Fire and forget: `keepalive` lets it
 * finish while the page is going away, and a failure changes nothing here (the slot also frees itself after 15 minutes).
 */
function releaseSlot(callId: string): void {
  fetch(`/api/test-calls/${encodeURIComponent(callId)}/release`, { method: "POST", keepalive: true, cache: "no-store" }).catch(() => {});
}

const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-report-line-strong bg-report-surface px-4 text-sm font-semibold enabled:hover:bg-report-calm-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:text-report-ink-2";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-report-accent px-4 text-sm font-semibold text-white enabled:hover:bg-report-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:opacity-70";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li>
      <div className="text-[13px] text-report-muted">{label}</div>
      <div className="flex items-center gap-2 text-sm">{children}</div>
    </li>
  );
}

function Heading({ lead, next }: { lead: string; next?: string }) {
  return (
    <h1 className="max-w-[760px] font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.01em] sm:text-[32px] sm:tracking-[-0.02em]">
      {lead}
      {next ? <> <span className="text-report-muted">{next}</span></> : null}
    </h1>
  );
}

function Transcript({ turns, label, className = "" }: { turns: Turn[]; label: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  // Whether the reader is at the bottom (or near it). The newest turn stays in view only then: a reader who has scrolled up to
  // look at something is not pulled away from it.
  const atBottom = useRef(true);
  const track = () => {
    const el = box.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  };
  useEffect(() => {
    if (box.current && atBottom.current) box.current.scrollTop = box.current.scrollHeight;
  }, [turns]);
  return (
    <section aria-labelledby="transcript-heading" className={className}>
      <h2 id="transcript-heading" className="mb-3 text-base font-semibold">
        {label}
      </h2>
      <div ref={box} onScroll={track} role="log" aria-label={label} tabIndex={0} className="max-h-[56vh] overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent lg:max-h-[calc(100vh-14rem)]">
        {turns.length === 0 ? (
          <p className="text-sm text-report-muted">{label === TEST_WORDS.transcriptLive ? TEST_WORDS.transcriptWaiting : TEST_WORDS.transcriptNone}</p>
        ) : (
          <ol className="space-y-4">
            {turns.map((t, i) => (
              <li key={i} className={t.role === "caller" ? "border-l-2 border-report-accent pl-3" : "pl-[14px]"}>
                <span className="block text-[13px] font-semibold text-report-ink-2">{t.role === "agent" ? TEST_WORDS.agentTurn : TEST_WORDS.callerTurn}</span>
                <span className="block text-[15px] leading-relaxed">{t.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

export function TestCallScreen({ pollMs = DEFAULT_POLL_MS, stubbable = false }: Props) {
  const [agents, setAgents] = useState<Agents>({ kind: "loading" });
  const [agentId, setAgentId] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [mic, setMic] = useState<MicState>("idle");
  const [connection, setConnection] = useState<ConnectionState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [agentName, setAgentName] = useState("");
  const [callId, setCallId] = useState<string | null>(null);
  const [hasClient, setHasClient] = useState(false);
  /** How a call that never connected ended, or null. */
  const [unconnected, setUnconnected] = useState<"failed" | "cancelled" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pollNote, setPollNote] = useState<string | null>(null);
  const [pollFor, setPollFor] = useState<string | null>(null);

  const clientRef = useRef<Client | null>(null);
  const run = useRef({ connected: false, finished: false });
  /** The call the server started for this screen, once it has said so. */
  const callIdRef = useRef<string | null>(null);
  /** A start is under way (the microphone prompt included). Read synchronously, so two quick clicks make one call. */
  const starting = useRef(false);
  const mounted = useRef(true);
  const interval = Math.max(MIN_POLL_MS, pollMs);

  const loadAgents = useCallback(async () => {
    setAgents({ kind: "loading" });
    try {
      const res = await fetch("/api/agents", { cache: "no-store" });
      const body: unknown = await res.json().catch(() => null);
      const list = res.ok ? agentsOf(body) : null;
      if (list) {
        setAgents({ kind: "ready", list });
        setAgentId((now) => (now !== "" ? now : list.length === 1 ? list[0].id : ""));
      } else {
        setAgents({ kind: "failed", message: isRec(body) && typeof body.message === "string" ? body.message : TEST_WORDS.unreachable });
      }
    } catch {
      setAgents({ kind: "failed", message: TEST_WORDS.unreachable });
    }
  }, []);

  // The agents on this key, once. (Written as a microtask so the first render is on screen before state changes.)
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => void loadAgents());
    return () => {
      mounted.current = false;
      // A call still going when the screen goes away must not keep the microphone.
      clientRef.current?.stopCall();
      clientRef.current?.removeAllListeners();
      // A call that never connected holds the server's slot for nothing: free it.
      const id = callIdRef.current;
      if (id !== null && !run.current.connected && !run.current.finished) {
        run.current.finished = true;
        releaseSlot(id);
      }
    };
  }, [loadAgents]);

  // After the call: ask where it stands, every few seconds, until the answer will not change.
  useEffect(() => {
    if (pollFor === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Asks in a row that Retell or Overhear could not answer. Each one doubles the wait (3, 6, 12 seconds, then 15 at most), so
    // a Retell that is limiting or failing is not asked more often; one answer ends the back-off.
    let trouble = 0;
    const ask = async () => {
      try {
        const res = await fetch(`/api/test-calls/${encodeURIComponent(pollFor)}/result`, { cache: "no-store" });
        const body: unknown = await res.json().catch(() => null);
        if (!live) return;
        if (res.ok && isRec(body)) {
          const done = outcomeOf(body);
          setPollNote(null);
          trouble = 0;
          if (done) {
            setOutcome(done);
            return;
          }
        } else if (isRec(body) && typeof body.error === "string" && typeof body.message === "string") {
          if (!TRANSIENT.has(body.error)) {
            setPollNote(null);
            setOutcome({ kind: "refused", message: body.message });
            return;
          }
          setPollNote(body.message);
          trouble += 1;
        } else {
          setPollNote(TEST_WORDS.unreachable);
          trouble += 1;
        }
      } catch {
        if (!live) return;
        setPollNote(TEST_WORDS.unreachable);
        trouble += 1;
      }
      timer = setTimeout(ask, Math.max(interval, Math.min(MAX_POLL_MS, interval * 2 ** trouble)));
    };
    timer = setTimeout(ask, interval);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pollFor, interval]);

  /**
   * The call is over, one way or another. Said once: the SDK can report the end more than once.
   * "ended" is a call that connected: Retell has a record to wait for. "failed" and "cancelled" never connected, so there is
   * nothing to wait for: the server's one-call slot is freed instead, and the person can start again at once.
   */
  const finish = useCallback((id: string, how: "ended" | "failed" | "cancelled") => {
    if (run.current.finished || !mounted.current) return;
    run.current.finished = true;
    setPhase("ended");
    setMic("off");
    setConnection(how === "failed" ? "failed" : "ended");
    if (how === "ended") {
      setPollFor(id);
      return;
    }
    if (how === "failed") setProblem(TEST_WORDS.connectionFailed);
    setUnconnected(how);
    releaseSlot(id);
  }, []);

  function makeClient(): Client {
    const stub = stubbable ? (globalThis as { __overhearStubClient?: () => Client }).__overhearStubClient : undefined;
    return stub ? stub() : new RetellWebClient();
  }

  async function start() {
    const agent = agents.kind === "ready" ? agents.list.find((a) => a.id === agentId) : undefined;
    // Synchronous, so a second click before the screen has re-rendered (the microphone prompt is open) starts nothing.
    if (!agent || phase !== "idle" || starting.current) return;
    starting.current = true;
    run.current = { connected: false, finished: false };
    callIdRef.current = null;
    setUnconnected(null);
    setProblem(null);
    setOutcome(null);
    setPollNote(null);
    setPollFor(null);
    setTurns([]);
    setCallId(null);
    setHasClient(false);
    setAgentName(agent.name);
    setMic("asking");
    setConnection("idle");

    // 1. The microphone, before anything that costs a minute.
    const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!devices || typeof devices.getUserMedia !== "function") {
      starting.current = false;
      setMic("blocked");
      setProblem(TEST_WORDS.micMissing);
      return;
    }
    try {
      const stream = await devices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      starting.current = false;
      if (!mounted.current) return;
      setMic("blocked");
      setProblem(TEST_WORDS.micBlocked);
      return;
    }
    if (!mounted.current) return;
    setMic("allowed");
    setConnection("connecting");
    setPhase("connecting");

    // 2. The server starts the call.
    let joined: Config & { callId: string };
    try {
      const res = await fetch("/api/test-calls", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ agentId: agent.id }), cache: "no-store" });
      const body: unknown = await res.json().catch(() => null);
      if (!mounted.current) {
        // The screen went away while the server was starting the call: nobody will join it, so free the slot it took.
        if (res.ok && isRec(body) && typeof body.callId === "string") releaseSlot(body.callId);
        return;
      }
      if (!res.ok || !isRec(body) || typeof body.callId !== "string" || typeof body.accessToken !== "string") {
        starting.current = false;
        setProblem(isRec(body) && typeof body.message === "string" ? body.message : TEST_WORDS.unreachable);
        setPhase("idle");
        setConnection("idle");
        setMic("allowed");
        return;
      }
      const transport = body.transport === "gateway" || body.transport === "livekit" ? body.transport : undefined;
      const iceServers = Array.isArray(body.iceServers) ? (body.iceServers as Config["iceServers"]) : undefined;
      joined = { callId: body.callId, accessToken: body.accessToken, transport, iceServers };
    } catch {
      starting.current = false;
      if (!mounted.current) return;
      setProblem(TEST_WORDS.unreachable);
      setPhase("idle");
      setConnection("idle");
      setMic("allowed");
      return;
    }

    // 3. The browser joins it.
    const id = joined.callId;
    const client = makeClient();
    clientRef.current = client;
    callIdRef.current = id;
    setCallId(id);
    setHasClient(true);
    client.on("call_started", () => {
      if (!mounted.current || clientRef.current !== client) return;
      run.current.connected = true;
      setPhase("live");
      setMic("on");
      setConnection("connected");
    });
    client.on("update", (event: unknown) => {
      if (!mounted.current || clientRef.current !== client) return;
      const next = turnsOf(event);
      if (next) setTurns(next);
    });
    client.on("call_ended", () => {
      if (clientRef.current === client) finish(id, "ended");
    });
    client.on("error", () => {
      if (clientRef.current !== client) return;
      const wasConnected = run.current.connected;
      // The SDK says only that something failed; Overhear says it in its own words and ends the call.
      client.stopCall();
      finish(id, wasConnected ? "ended" : "failed");
      if (wasConnected) setProblem(TEST_WORDS.connectionFailed);
    });
    try {
      await client.startCall(joined);
    } catch {
      client.stopCall();
      finish(id, run.current.connected ? "ended" : "failed");
    }
  }

  function end() {
    const client = clientRef.current;
    if (!client || callId === null) return;
    // A call that had not connected has nothing to end the call with, so the end is said first, here: stopping it can make
    // the SDK report an error, and that must not read as a failed connection.
    if (!run.current.connected) finish(callId, "cancelled");
    client.stopCall();
  }

  function again() {
    starting.current = false;
    clientRef.current?.removeAllListeners();
    clientRef.current = null;
    callIdRef.current = null;
    setUnconnected(null);
    setPhase("idle");
    setMic("idle");
    setConnection("idle");
    setTurns([]);
    setProblem(null);
    setOutcome(null);
    setPollNote(null);
    setPollFor(null);
    setCallId(null);
    setHasClient(false);
  }

  const picker = phase === "idle";
  const finished = outcome !== null;
  const reportShown = outcome?.kind === "report";

  const headline = ((): { lead: string; next?: string } | null => {
    if (picker) return { lead: TEST_WORDS.idleLead, next: TEST_WORDS.idleNext };
    if (phase === "connecting") return { lead: TEST_WORDS.connectingLead, next: TEST_WORDS.connectingNext };
    if (phase === "live") return { lead: TEST_WORDS.liveLead, next: TEST_WORDS.liveNext };
    switch (outcome?.kind) {
      case "report":
        return null;
      case "no_content":
        return { lead: TEST_WORDS.noContentLead, next: outcome.message };
      case "problem":
        return { lead: TEST_WORDS.errorLead, next: outcome.message || undefined };
      case "did_not_connect":
        return { lead: TEST_WORDS.noReportLead, next: outcome.message };
      case "timeout":
        return { lead: TEST_WORDS.timeoutLead, next: outcome.message };
      case "refused":
        return { lead: TEST_WORDS.errorLead };
      default:
        if (unconnected === "failed") return { lead: TEST_WORDS.couldntConnectLead, next: TEST_WORDS.couldntConnectNext };
        if (unconnected === "cancelled") return { lead: TEST_WORDS.cancelledLead, next: TEST_WORDS.cancelledNext };
        return { lead: TEST_WORDS.processingLead, next: TEST_WORDS.processingNext };
    }
  })();

  const processing = phase === "ended" && !finished && unconnected === null;
  const showTranscript = !picker;
  const transcriptLabel = phase === "live" || phase === "connecting" ? TEST_WORDS.transcriptLive : TEST_WORDS.transcriptSaw;
  const startable = agents.kind === "ready" && agentId !== "" && mic !== "asking";

  const facts = picker && mic === "idle" ? null : (
    <ul aria-label="Call state" className="mt-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:flex sm:flex-wrap">
      <Fact label={TEST_WORDS.factAgent}>{agentName}</Fact>
      <Fact label={TEST_WORDS.factMic}>{TEST_WORDS.mic[mic]}</Fact>
      <Fact label={TEST_WORDS.factConnection}>
        {connection === "connected" ? <span aria-hidden className="size-2 rounded-full bg-report-accent" /> : null}
        {TEST_WORDS.connection[connection]}
      </Fact>
    </ul>
  );

  return (
    <div className="report min-h-screen bg-report-canvas font-sans text-report-ink">
      <div className={`mx-auto px-4 pb-24 pt-6 sm:px-6 ${reportShown ? "max-w-[1360px]" : "max-w-[1200px]"}`}>
        <div className="-mt-3 mb-7 flex items-center gap-4 sm:mb-11">
          <p className="text-sm font-semibold tracking-[-0.01em] text-report-ink-2">{CONNECT_WORDS.product}</p>
          <BackLink local />
        </div>
        <main>
          {headline ? <Heading lead={headline.lead} next={headline.next} /> : <p className="text-sm text-report-muted">{TEST_WORDS.finished}</p>}

          <div role="status" className="mt-4 text-sm empty:mt-0">
            {pollNote ? (
              <p className="flex gap-2 text-report-warning">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="font-semibold">{pollNote}</span>
              </p>
            ) : processing ? (
              <p className="flex items-center gap-2 text-report-ink-2">
                <span aria-hidden className="report-delayed inline-flex">
                  <Loader2 className="size-4 motion-safe:animate-spin" />
                </span>
                {TEST_WORDS.stillTrying}
              </p>
            ) : null}
          </div>

          {problem && !picker ? (
            <p role="alert" className="mt-4 flex gap-2 text-sm font-semibold text-report-critical">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{problem}</span>
            </p>
          ) : null}
          {outcome?.kind === "refused" ? (
            <p role="alert" className="mt-4 flex gap-2 text-sm font-semibold text-report-critical">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>{outcome.message}</span>
            </p>
          ) : null}

          {picker ? (
            <div className="mt-10 max-w-[480px]">
              {agents.kind === "loading" ? <p className="text-sm text-report-muted">{TEST_WORDS.agentsLoading}</p> : null}
              {agents.kind === "failed" ? (
                <div>
                  <p role="alert" className="flex gap-2 text-sm font-semibold text-report-critical">
                    <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <span>{agents.message}</span>
                  </p>
                  <button type="button" onClick={() => void loadAgents()} className={`${BUTTON} mt-4`}>
                    {TEST_WORDS.tryAgain}
                  </button>
                </div>
              ) : null}
              {agents.kind === "ready" && agents.list.length === 0 ? (
                <div>
                  <p className="text-base font-semibold">{TEST_WORDS.agentsEmpty}</p>
                  <p className="mt-1 text-sm text-report-ink-2">{TEST_WORDS.agentsEmptyNext}</p>
                  <button type="button" onClick={() => void loadAgents()} className={`${BUTTON} mt-4`}>
                    {TEST_WORDS.checkAgain}
                  </button>
                </div>
              ) : null}
              {agents.kind === "ready" && agents.list.length > 0 ? (
                <div>
                  <label htmlFor="agent" className="text-sm font-semibold">
                    {TEST_WORDS.agentLabel}
                  </label>
                  <select
                    id="agent"
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                    className="mt-1 block min-h-11 w-full rounded-md border border-report-line-strong bg-report-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent"
                  >
                    <option value="" disabled>
                      {TEST_WORDS.agentPlaceholder}
                    </option>
                    {agents.list.map((a) => (
                      <option key={a.id} value={a.id}>
                        {`${a.name} (${a.id})`}
                      </option>
                    ))}
                  </select>
                  <p className="mt-4 text-sm text-report-ink-2">{TEST_WORDS.cost}</p>
                  <p className="mt-1 text-[13px] text-report-muted">{TEST_WORDS.micNote}</p>
                  {facts}
                  {problem ? (
                    <p role="alert" className="mt-4 flex gap-2 text-sm font-semibold text-report-critical">
                      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                      <span>{problem}</span>
                    </p>
                  ) : null}
                  <button type="button" onClick={() => void start()} disabled={!startable} className={`${PRIMARY} mt-6`}>
                    {TEST_WORDS.start}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            facts
          )}

          {phase === "connecting" || phase === "live" ? (
            <div className="mt-6">
              <button type="button" onClick={end} disabled={!hasClient} className={BUTTON}>
                {hasClient ? TEST_WORDS.end : TEST_WORDS.starting}
              </button>
            </div>
          ) : null}

          {phase === "ended" && (finished || unconnected !== null) ? (
            <div className="mt-6">
              <button type="button" onClick={again} className={BUTTON}>
                {TEST_WORDS.another}
              </button>
            </div>
          ) : null}

          {showTranscript ? (
            reportShown ? (
              <div className="mt-10 flex flex-col gap-y-12 lg:grid lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start lg:gap-x-12 lg:gap-y-0">
                {/* The verdict leads in a narrow window; the transcript sits beside it from lg up. */}
                <div className="order-2 lg:order-1 lg:sticky lg:top-6">
                  <Transcript turns={turns} label={transcriptLabel} />
                  <p className="mt-4 text-[13px] text-report-muted">{TEST_WORDS.transcriptFinalRecord}</p>
                </div>
                <div className="order-1 min-w-0 lg:order-2">{outcome?.kind === "report" ? <CallReportView report={outcome.report} keep narrow /> : null}</div>
              </div>
            ) : (
              <Transcript turns={turns} label={transcriptLabel} className="mt-10 max-w-[760px]" />
            )
          ) : null}
        </main>
      </div>
    </div>
  );
}
