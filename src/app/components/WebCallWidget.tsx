"use client";

// WebCallWidget - lets a visitor talk to the scheduling agent right in the
// browser. Mints a one-time access token from /api/web-call (Task 6), then
// hands it to the SDK's 2.x client, which owns the mic and the WebRTC
// transport. RetellWebClient is documented as deprecated in favor of
// RetellClient's createWebCall()/monitorCall(), but it is kept in the SDK
// specifically for this "bring your own access_token" flow, which is what
// our route already returns - see node_modules/retell-client-js-sdk/src/legacy/retell-web-client.ts.
import { useCallback, useEffect, useRef, useState } from "react";
import { RetellWebClient } from "retell-client-js-sdk";

type CallStatus = "idle" | "connecting" | "live" | "ended" | "error";

const GENERIC_ERROR = "Could not start the call.";
const RATE_LIMITED_MESSAGE = "The demo is busy right now. Please try again in a few minutes.";

export function WebCallWidget() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clientRef = useRef<RetellWebClient | null>(null);
  const mountedRef = useRef(true);

  // Built once, on first use: the same instance has to receive both
  // startCall() and stopCall(), and constructing it only when a call is
  // actually requested keeps module import side-effect free for SSR.
  const getClient = useCallback((): RetellWebClient => {
    if (!clientRef.current) clientRef.current = new RetellWebClient();
    return clientRef.current;
  }, []);

  // Register the SDK listeners exactly once, on mount, and tear the call
  // down on unmount. A visitor can navigate away (CallList uses next/link
  // soft navigation) while a call is live: without this, the mic stays
  // hot, the transport keeps running with no UI left to hang up from, and
  // the orphaned listeners keep calling setState after the component is
  // gone. mountedRef guards every state update the listeners make so a
  // late event (one already in flight when unmount happens) is a no-op.
  useEffect(() => {
    mountedRef.current = true;
    const client = getClient();

    const handleCallStarted = () => {
      if (mountedRef.current) setStatus("live");
    };
    const handleCallEnded = () => {
      if (mountedRef.current) setStatus("ended");
    };
    const handleError = (message: unknown) => {
      if (!mountedRef.current) return;
      setErrorMessage(typeof message === "string" ? message : "The call failed.");
      setStatus("error");
    };

    client.on("call_started", handleCallStarted);
    client.on("call_ended", handleCallEnded);
    client.on("error", handleError);

    return () => {
      mountedRef.current = false;
      client.stopCall();
      client.removeAllListeners();
    };
  }, [getClient]);

  const startCall = useCallback(async () => {
    setErrorMessage(null);
    setStatus("connecting");

    try {
      const response = await fetch("/api/web-call", { method: "POST" });
      // A 429 is an expected, friendly outcome (the demo's spend guard), not a
      // failure to log: show the specific "try again later" message.
      if (response.status === 429) {
        if (mountedRef.current) {
          setErrorMessage(RATE_LIMITED_MESSAGE);
          setStatus("error");
        }
        return;
      }
      if (!response.ok) throw new Error(GENERIC_ERROR);

      const { accessToken, callId, transport, iceServers } = await response.json();
      await getClient().startCall({ accessToken, callId, transport, iceServers });
    } catch (err) {
      // A failed start (no Retell key, a network error, a bad body) is an
      // expected, user-facing outcome, not a crash: show the friendly inline
      // message and log at warn level. console.error would trip the Next dev
      // error overlay and make a handled failure look like a crash.
      console.warn("Could not start the web call", err);
      if (mountedRef.current) {
        setErrorMessage(GENERIC_ERROR);
        setStatus("error");
      }
    }
  }, [getClient]);

  const hangUp = useCallback(() => {
    clientRef.current?.stopCall();
  }, []);

  const isLive = status === "live";
  const isConnecting = status === "connecting";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        {isLive ? (
          <button
            type="button"
            onClick={hangUp}
            className="rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600"
          >
            Hang up
          </button>
        ) : (
          <button
            type="button"
            onClick={startCall}
            disabled={isConnecting}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isConnecting ? "Connecting..." : "Talk to the scheduling agent"}
          </button>
        )}

        <span className="text-sm text-zinc-400" role="status" aria-live="polite">
          {isLive && "Live, the agent can hear you."}
          {status === "ended" && "Call ended."}
          {status === "error" && (errorMessage ?? "Something went wrong.")}
        </span>
      </div>

      <p className="text-xs text-zinc-500">
        Your browser will ask for microphone access when you start the call.
      </p>
    </div>
  );
}
