"use client";

// The band on the hosted sample list that lets a visitor call our demo clinic agent from the browser and see Overhear's verdict
// on that call seconds after hanging up. It is the hosted counterpart of the local test call screen and shares its steps:
//   1. The microphone is asked for first. A blocked microphone stops here: no call is made.
//   2. POST /api/demo-calls starts the call on the server's own Retell key and answers only what the browser needs to join. The
//      server also sets a signed cookie that makes the call this browser's own.
//   3. The SDK's client joins. After the call ends (call_ended), GET /api/demo-calls/{id} is asked every 3 seconds, never faster
//      than every 2, until it says ready, timeout or did_not_connect. A ready answer is the list's own row for the call.
// There is no live transcript here: the report shows the whole call a few seconds after hang-up. Nothing is stored in the tab.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { RetellWebClient } from "retell-client-js-sdk";
import type { PullRow } from "@/pull/pull";
import { BUTTON, DEFAULT_POLL_MS, isRec, MIN_POLL_MS, PRIMARY, requestMicrophone } from "./callClient";
import { CallRow } from "./CallRow";
import { DEMO_PERSONAS } from "@/demo/personas";
import { DEMO_PROVIDERS } from "@/demo/providers";
import { bornInWords, busyMinutes, DEMO_CALL_WORDS as WORDS, formatElapsed } from "./demoCallWords";

/** Asks in a row that fail before the band gives up and says so. */
const MAX_TROUBLE = 3;
const MAX_POLL_MS = 15000;
const JSON_HEADERS = { "content-type": "application/json" };

/** The browser's IANA time zone, so the agent can translate clinic times for the caller. Empty when the browser will not say. */
function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

type Problem = "did_not_connect" | "timeout" | "error";
type Stage =
  | { kind: "idle" }
  | { kind: "asking" }
  | { kind: "blocked" }
  | { kind: "connecting" }
  | { kind: "live" }
  | { kind: "checking" }
  | { kind: "ready"; row: PullRow }
  | { kind: "problem"; problem: Problem }
  | { kind: "busy"; minutes: number };

type Client = Pick<RetellWebClient, "on" | "startCall" | "stopCall" | "removeAllListeners">;
type Config = Parameters<RetellWebClient["startCall"]>[0];

type Props = {
  /** Milliseconds between asks for the result once the call has ended. Never less than 2000. */
  pollMs?: number;
};

/** A real person's name that stays in the data and never shows on the page. */
const HIDDEN_PERSONA = "Devanshu Chicholikar";
const SHOWN_PERSONAS = DEMO_PERSONAS.filter((p) => p.name !== HIDDEN_PERSONA);
const DOCTOR_NAMES = DEMO_PROVIDERS.map((p) => p.name);

/** Hang up is a critical outline: the same button, with the critical colour for its border and its words. */
const HANG_UP = BUTTON.replace("border-report-line-strong", "border-report-critical text-report-critical");

/** A list row from the result route, or null when the answer is not one. Built field by field. */
function rowOf(value: unknown): PullRow | null {
  if (!isRec(value) || typeof value.callId !== "string" || typeof value.state !== "string") return null;
  return value as PullRow;
}

/** A stand-in for the SDK's client may be set on the window in a development build, for screenshots and demos. Never in production. */
function makeClient(): Client {
  if (process.env.NODE_ENV !== "production") {
    const stub = (globalThis as { __overhearStubClient?: () => Client }).__overhearStubClient;
    if (stub) return stub();
  }
  return new RetellWebClient();
}

/** Every shown test patient, as a plain list, for while a call is starting, running or being checked. */
function PatientsDuringCall() {
  return (
    <div className="mt-3 max-w-[640px] text-sm text-report-muted">
      <p>{WORDS.duringCallClinic(DOCTOR_NAMES)}</p>
      {SHOWN_PERSONAS.length > 0 ? (
        <>
          <p className="mt-2 text-[13px]">{WORDS.duringCall}</p>
          <ul className="mt-1">
            {SHOWN_PERSONAS.map((p) => (
              <li key={p.name}>{WORDS.patientLine(p.name, bornInWords(p.dob))}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

export function DemoCallBand({ pollMs = DEFAULT_POLL_MS }: Props) {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [elapsed, setElapsed] = useState(0);
  const [pollFor, setPollFor] = useState<string | null>(null);

  const clientRef = useRef<Client | null>(null);
  const run = useRef({ connected: false, finished: false });
  const callIdRef = useRef<string | null>(null);
  /** A start is under way (the microphone prompt included). Read synchronously, so two quick clicks make one call. */
  const starting = useRef(false);
  const mounted = useRef(true);
  const interval = Math.max(MIN_POLL_MS, pollMs);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // A call still going when the page goes away must not keep the microphone.
      clientRef.current?.stopCall();
      clientRef.current?.removeAllListeners();
    };
  }, []);

  // In the call: the elapsed time, once a second, and nothing else moves.
  const live = stage.kind === "live";
  useEffect(() => {
    if (!live) return;
    const began = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - began) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [live]);

  // After the call: ask where it stands until the answer will not change.
  useEffect(() => {
    if (pollFor === null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Asks in a row that failed. Each one doubles the wait (3, 6, 12 seconds, then 15 at most); a few in a row end the wait.
    let trouble = 0;
    const settle = (next: Stage) => {
      if (!alive) return;
      setPollFor(null);
      setStage(next);
    };
    const ask = async () => {
      try {
        const res = await fetch(`/api/demo-calls/${encodeURIComponent(pollFor)}`, { cache: "no-store" });
        const body: unknown = await res.json().catch(() => null);
        if (!alive) return;
        if (res.ok && isRec(body)) {
          trouble = 0;
          if (body.status === "ready") {
            const row = rowOf(body.row);
            return settle(row ? { kind: "ready", row } : { kind: "problem", problem: "error" });
          }
          if (body.status === "timeout") return settle({ kind: "problem", problem: "timeout" });
          if (body.status === "did_not_connect") return settle({ kind: "problem", problem: "did_not_connect" });
        } else if (res.status === 404 || res.status === 403) {
          // Not this browser's call, or no longer kept: asking again will not change that.
          return settle({ kind: "problem", problem: "error" });
        } else {
          trouble += 1;
        }
      } catch {
        if (!alive) return;
        trouble += 1;
      }
      if (trouble >= MAX_TROUBLE) return settle({ kind: "problem", problem: "error" });
      timer = setTimeout(ask, Math.max(interval, Math.min(MAX_POLL_MS, interval * 2 ** trouble)));
    };
    timer = setTimeout(ask, interval);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [pollFor, interval]);

  /** The call is over, one way or another. Said once: the SDK can report the end more than once. A call that never connected has no record to wait for. */
  const finish = useCallback((id: string, how: "ended" | "failed") => {
    if (run.current.finished || !mounted.current) return;
    run.current.finished = true;
    if (how === "ended") {
      setStage({ kind: "checking" });
      setPollFor(id);
    } else {
      setStage({ kind: "problem", problem: "did_not_connect" });
    }
  }, []);

  async function start() {
    // Synchronous, so a second click before the band has re-rendered (the microphone prompt is open) starts nothing.
    if (starting.current) return;
    starting.current = true;
    run.current = { connected: false, finished: false };
    callIdRef.current = null;
    clientRef.current = null;
    setElapsed(0);
    setPollFor(null);
    setStage({ kind: "asking" });

    // 1. The microphone, before anything that costs a minute.
    if ((await requestMicrophone()) !== "allowed") {
      starting.current = false;
      if (mounted.current) setStage({ kind: "blocked" });
      return;
    }
    if (!mounted.current) return;
    setStage({ kind: "connecting" });

    // 2. The server starts the call.
    let joined: Config & { callId: string };
    try {
      const res = await fetch("/api/demo-calls", { method: "POST", headers: JSON_HEADERS, cache: "no-store", body: JSON.stringify({ timeZone: browserZone() }) });
      const body: unknown = await res.json().catch(() => null);
      if (!mounted.current) return;
      if (res.status === 429) {
        starting.current = false;
        setStage({ kind: "busy", minutes: busyMinutes(isRec(body) ? body.retryAfter : undefined) });
        return;
      }
      if (!res.ok || !isRec(body) || typeof body.callId !== "string" || typeof body.accessToken !== "string") {
        starting.current = false;
        setStage({ kind: "problem", problem: "error" });
        return;
      }
      const transport = body.transport === "gateway" || body.transport === "livekit" ? body.transport : undefined;
      const iceServers = Array.isArray(body.iceServers) ? (body.iceServers as Config["iceServers"]) : undefined;
      joined = { callId: body.callId, accessToken: body.accessToken, transport, iceServers };
    } catch {
      starting.current = false;
      if (mounted.current) setStage({ kind: "problem", problem: "error" });
      return;
    }

    // 3. The browser joins it.
    const id = joined.callId;
    const client = makeClient();
    clientRef.current = client;
    callIdRef.current = id;
    client.on("call_started", () => {
      if (!mounted.current || clientRef.current !== client) return;
      run.current.connected = true;
      setStage({ kind: "live" });
    });
    client.on("call_ended", () => {
      if (clientRef.current === client) finish(id, run.current.connected ? "ended" : "failed");
    });
    client.on("error", () => {
      if (clientRef.current !== client) return;
      const connected = run.current.connected;
      // The SDK says only that something failed; the band says it in its own words and ends the call.
      client.stopCall();
      finish(id, connected ? "ended" : "failed");
    });
    try {
      await client.startCall(joined);
    } catch {
      client.stopCall();
      finish(id, run.current.connected ? "ended" : "failed");
    }
  }

  function hangUp() {
    const client = clientRef.current;
    const id = callIdRef.current;
    if (!client || id === null) return;
    client.stopCall();
    // The SDK reports the end itself; this is so the band never waits on a word that does not come.
    finish(id, "ended");
  }

  /** After a timeout: ask about the same call again. The call is kept, so this starts nothing new. */
  function checkAgain() {
    const id = callIdRef.current;
    if (id === null) return;
    setStage({ kind: "checking" });
    setPollFor(id);
  }

  /** Try again and Call again start the next call at once: the band has already said everything the person needs to know. */
  function again() {
    starting.current = false;
    clientRef.current?.removeAllListeners();
    clientRef.current = null;
    callIdRef.current = null;
    setPollFor(null);
    void start();
  }

  const sentence =
    stage.kind === "blocked"
      ? WORDS.micBlocked
      : stage.kind === "problem"
        ? stage.problem === "did_not_connect"
          ? WORDS.didNotConnect
          : stage.problem === "timeout"
            ? WORDS.timeout
            : WORDS.error
        : stage.kind === "busy"
          ? WORDS.busy(stage.minutes)
          : null;

  return (
    <section aria-labelledby="demo-call-lead" className="mt-8 border-y border-report-line py-5">
      {stage.kind === "idle" || stage.kind === "asking" ? (
        <>
          <h2 id="demo-call-lead" className="text-base font-semibold">
            {WORDS.lead}
          </h2>
          <p className="mt-1 max-w-[640px] text-sm text-report-muted">{WORDS.body}</p>
          <h3 className="mt-3 text-sm font-semibold">{WORDS.beforeYouCall}</h3>
          <ul className="mt-1 max-w-[640px] space-y-1 text-sm text-report-muted">
            <li>{WORDS.clinicZone}</li>
            <li>{WORDS.whatRileyDoes}</li>
            <li>{WORDS.doctors(DOCTOR_NAMES)}</li>
            {SHOWN_PERSONAS.length > 0 ? (
              <li>
                {WORDS.firstPatient(SHOWN_PERSONAS[0].name, bornInWords(SHOWN_PERSONAS[0].dob))}
                {SHOWN_PERSONAS.length > 1 ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer">{WORDS.morePatients}</summary>
                    <ul className="mt-1">
                      {SHOWN_PERSONAS.slice(1).map((p) => (
                        <li key={p.name}>{WORDS.patientLine(p.name, bornInWords(p.dob))}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-[13px]">{WORDS.spellName}</p>
                  </details>
                ) : null}
              </li>
            ) : null}
            <li>{WORDS.callLimit}</li>
          </ul>
          <button type="button" onClick={() => void start()} disabled={stage.kind === "asking"} className={`${PRIMARY} mt-4`}>
            {stage.kind === "asking" ? WORDS.asking : WORDS.call}
          </button>
          <p className="mt-2 max-w-[640px] text-[13px] text-report-muted">{WORDS.finePrint}</p>
        </>
      ) : stage.kind === "connecting" ? (
        <>
          <p id="demo-call-lead" role="status" className="text-sm font-semibold">
            {WORDS.connecting}
          </p>
          <PatientsDuringCall />
        </>
      ) : stage.kind === "live" ? (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p id="demo-call-lead" className="text-sm font-semibold">
            {WORDS.live}{" "}
            <span aria-label={WORDS.elapsedLabel} className="ml-2 font-normal tabular-nums text-report-ink-2">
              {formatElapsed(elapsed)}
            </span>
          </p>
          <button type="button" onClick={hangUp} className={HANG_UP}>
            {WORDS.hangUp}
          </button>
          <div className="basis-full">
            <PatientsDuringCall />
          </div>
        </div>
      ) : stage.kind === "checking" ? (
        <>
          <p id="demo-call-lead" role="status" className="flex items-center gap-2 text-sm font-semibold">
            {WORDS.checking}
            <span aria-hidden className="report-delayed inline-flex">
              <Loader2 className="size-4 motion-safe:animate-spin" />
            </span>
          </p>
          <PatientsDuringCall />
        </>
      ) : stage.kind === "ready" ? (
        <>
          <h2 id="demo-call-lead" className="text-base font-semibold">
            {WORDS.yourCall}
          </h2>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <ul aria-label={WORDS.yourCall} className="-ml-3 min-w-0 flex-1 border-y border-report-line bg-report-surface">
              <CallRow row={stage.row} timeZone="UTC" settled retrying={false} retryFailed={false} showTime={false} />
            </ul>
            <button type="button" onClick={again} className={BUTTON}>
              {WORDS.callAgain}
            </button>
          </div>
        </>
      ) : (
        <>
          <p id="demo-call-lead" role="status" className="max-w-[640px] text-sm font-semibold">
            {sentence}
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            {stage.kind === "problem" && stage.problem === "timeout" ? (
              <button type="button" onClick={checkAgain} className={BUTTON}>
                {WORDS.checkAgain}
              </button>
            ) : null}
            <button type="button" onClick={again} className={BUTTON}>
              {stage.kind === "problem" && stage.problem === "timeout" ? WORDS.callAgain : WORDS.tryAgain}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
