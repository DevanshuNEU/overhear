"use client";

// The top of the call list: the product name on the left, and on the right that Retell is connected, where the
// key is saved, and Disconnect. Disconnect asks the server to delete the saved key (DELETE /api/connect), and
// only when that worked does it hand back, so the person never sees "disconnected" while the key is still there.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { CONNECT_WORDS } from "./ConnectScreen";
import { LIST_WORDS } from "./callListWords";

type Props = {
  /** The saved key file's path, as shown to the person (home folder written as ~). */
  location: string;
  /** Runs before the key is removed, so a pull in flight is stopped first. Never throws. */
  beforeDisconnect: () => Promise<void>;
  /** The key is gone. */
  onDisconnected: () => void;
};

export function ConnectionBar({ location, beforeDisconnect, onDisconnected }: Props) {
  const [phase, setPhase] = useState<"ready" | "removing" | "failed" | "unreachable">("ready");
  const removing = phase === "removing";

  async function disconnect() {
    if (removing) return;
    setPhase("removing");
    await beforeDisconnect();
    try {
      const res = await fetch("/api/connect", { method: "DELETE", cache: "no-store" });
      if (res.ok) return onDisconnected();
      setPhase("failed");
    } catch {
      setPhase("unreachable");
    }
  }

  return (
    <header className="mb-10 sm:mb-14">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="text-sm font-semibold tracking-[-0.01em] text-report-ink-2">{CONNECT_WORDS.product}</p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="text-[13px] text-report-muted">
            {LIST_WORDS.connected} {LIST_WORDS.keySavedIn}{" "}
            <span className="break-all font-mono tabular-nums">{location}</span>.
          </p>
          <button
            type="button"
            onClick={disconnect}
            disabled={removing}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-report-line-strong bg-report-surface px-4 text-sm font-semibold enabled:hover:bg-report-calm-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:text-report-ink-2"
          >
            {removing ? (
              <>
                <span aria-hidden className="report-delayed inline-flex">
                  <Loader2 className="size-4 motion-safe:animate-spin" />
                </span>
                {LIST_WORDS.disconnecting}
              </>
            ) : (
              LIST_WORDS.disconnect
            )}
          </button>
        </div>
      </div>
      {phase === "failed" || phase === "unreachable" ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-report-critical sm:text-right">
          {phase === "failed" ? LIST_WORDS.disconnectFailed : CONNECT_WORDS.serverDown}
        </p>
      ) : null}
    </header>
  );
}
