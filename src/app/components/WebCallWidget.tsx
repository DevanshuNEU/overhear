"use client";

// WebCallWidget - lets a visitor talk to the scheduling agent right in the
// browser. Mints a one-time access token from /api/web-call (Task 6), then
// hands it to the SDK's 2.x client, which owns the mic and the WebRTC
// transport. RetellWebClient is documented as deprecated in favor of
// RetellClient's createWebCall()/monitorCall(), but it is kept in the SDK
// specifically for this "bring your own access_token" flow, which is what
// our route already returns - see node_modules/retell-client-js-sdk/src/legacy/retell-web-client.ts.
import { useCallback, useRef, useState } from "react";
import { RetellWebClient } from "retell-client-js-sdk";

type CallStatus = "idle" | "connecting" | "live" | "ended" | "error";

export function WebCallWidget() {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const clientRef = useRef<RetellWebClient | null>(null);

  // Built once, on first use: the same instance has to receive both
  // startCall() and stopCall(), and constructing it only when a call is
  // actually requested keeps module import side-effect free for SSR.
  const getClient = useCallback((): RetellWebClient => {
    if (clientRef.current) return clientRef.current;

    const client = new RetellWebClient();
    client.on("call_started", () => setStatus("live"));
    client.on("call_ended", () => setStatus("ended"));
    client.on("error", (message: unknown) => {
      setErrorMessage(typeof message === "string" ? message : "The call failed.");
      setStatus("error");
    });
    clientRef.current = client;
    return client;
  }, []);

  const startCall = useCallback(async () => {
    setErrorMessage(null);
    setStatus("connecting");

    try {
      const response = await fetch("/api/web-call", { method: "POST" });
      if (!response.ok) throw new Error("Could not start the call.");

      const { accessToken } = await response.json();
      await getClient().startCall({ accessToken });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Could not start the call.");
      setStatus("error");
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

        <span className="text-sm text-zinc-400">
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
