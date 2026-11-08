"use client";

// The call list: the first screen once a Retell key is saved. It opens a pull of the last 25 calls on its own,
// polls /api/pulls/{id} while the engine checks them, and fills the list in as verdicts land. Calls that failed
// or need review go on top, so the answer never waits behind a long run of calls that passed. Every word that
// is not a verdict comes from callListWords.ts, and the verdict words from src/report/labels.ts.
// The key never reaches this file: the server holds it. A pull's id (not secret) is kept for the tab, so a reload
// shows the same pull instead of starting another.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import type { PullProgress } from "@/pull/pull";
import { PULL_ERROR_MESSAGE, type ConnectError } from "@/pull/labels";
import { RESULT_LABEL, VERDICT_LABEL } from "@/report/labels";
import { CallRow } from "./CallRow";
import { ConnectionBar } from "./ConnectionBar";
import { CONNECT_WORDS } from "./ConnectScreen";
import { LIST_WORDS } from "./callListWords";
import { countRows, secondsLeft, splitRows, type Counts } from "./callListModel";

export const CHOICES = [25, 50, 100] as const;
const DEFAULT_COUNT = 25;
const REMEMBER = "overhear.pull";
const JSON_HEADERS = { "content-type": "application/json" };

type Props = {
  /** The saved key file's path, as shown to the person. */
  location: string;
  /** Back to the connect screen: the key was removed (no notice), or Retell stopped accepting it ("bad_key"). */
  onDisconnected: (notice?: Extract<ConnectError, "bad_key">) => void;
  /** Zone for call times. Unset means the browser's own. */
  timeZone?: string;
  /** Milliseconds between polls while calls are being checked. */
  pollMs?: number;
  /** The clock, for the countdown in a pause. */
  now?: () => number;
};

const PHASES = new Set(["listing", "fetching", "done", "cancelled", "failed"]);

function isProgress(value: unknown): value is PullProgress {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Partial<PullProgress>;
  return typeof p.phase === "string" && PHASES.has(p.phase) && Array.isArray(p.rows) && typeof p.requested === "number";
}

const isActive = (p: PullProgress | null) => p !== null && (p.phase === "listing" || p.phase === "fetching");

function remember(id: string | null) {
  try {
    if (id === null) window.sessionStorage.removeItem(REMEMBER);
    else window.sessionStorage.setItem(REMEMBER, id);
  } catch {
    // Storage is off: a reload starts a new pull, which is fine.
  }
}

function remembered(): string | null {
  try {
    return window.sessionStorage.getItem(REMEMBER);
  } catch {
    return null;
  }
}

type Say = { lead: string; next?: string };

/** The headline: what the pull is doing, or what it found. */
function headlineFor(progress: PullProgress | null, counts: Counts, requested: number, problem: boolean): Say {
  if (problem) return { lead: LIST_WORDS.couldntStart, next: LIST_WORDS.couldntStartNext };
  if (progress === null || (progress.phase === "listing" && progress.rows.length === 0)) return { lead: LIST_WORDS.finding(requested), next: LIST_WORDS.findingNext };
  const processed = counts.total - counts.pending;
  switch (progress.phase) {
    case "listing":
    case "fetching":
      return { lead: LIST_WORDS.checked(processed, counts.total), next: LIST_WORDS.checkedNext };
    case "cancelled":
      return { lead: LIST_WORDS.stopped(processed, counts.total), next: LIST_WORDS.stoppedNext };
    case "failed":
      return { lead: counts.total === 0 ? LIST_WORDS.couldntList : LIST_WORDS.couldntFinish, next: progress.error ? PULL_ERROR_MESSAGE[progress.error.code] : undefined };
    case "done":
      if (counts.total === 0) return progress.skipped > 0 ? { lead: LIST_WORDS.noFinished, next: LIST_WORDS.noFinishedNext } : { lead: LIST_WORDS.noCalls, next: LIST_WORDS.noCallsNext };
      return { lead: LIST_WORDS.failedHeadline(counts.failed, counts.total), next: LIST_WORDS.doneNext };
  }
}

function Count({ label, n, tone }: { label: string; n: number; tone?: "critical" | "warning" }) {
  const color = n === 0 || tone === undefined ? "text-report-ink-2" : tone === "critical" ? "text-report-critical" : "text-report-warning";
  return (
    <span className={color}>
      <span className="font-semibold tabular-nums">{n}</span> {label}
    </span>
  );
}

const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-report-line-strong bg-report-surface px-4 text-sm font-semibold enabled:hover:bg-report-calm-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:text-report-ink-2";

export function CallListScreen({ location, onDisconnected: handOff, timeZone, pollMs = 1000, now: clockFn = Date.now }: Props) {
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [pullId, setPullId] = useState<string | null>(null);
  const [count, setCount] = useState<number>(DEFAULT_COUNT);
  const [startFailed, setStartFailed] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [retrying, setRetrying] = useState<ReadonlySet<string>>(new Set());
  const [retried, setRetried] = useState<ReadonlySet<string>>(new Set());
  const [clock, setClock] = useState(() => clockFn());

  // The pull this screen is showing and the count it asked for, readable from inside async work that outlives a render.
  const current = useRef<string | null>(null);
  const asked = useRef<number>(DEFAULT_COUNT);
  const booted = useRef(false);

  // The latest callbacks, so a parent that passes new functions on every render cannot restart the polling.
  const handOffRef = useRef(handOff);
  const clockRef = useRef(clockFn);
  useEffect(() => {
    handOffRef.current = handOff;
    clockRef.current = clockFn;
  });
  // Every way off this screen forgets the pull, so a key pasted next starts fresh instead of polling an id the server dropped.
  const onDisconnected = useCallback((notice?: Extract<ConnectError, "bad_key">) => {
    current.current = null;
    remember(null);
    handOffRef.current(notice);
  }, []);
  const now = useCallback(() => clockRef.current(), []);

  const adopt = useCallback((id: string) => {
    current.current = id;
    remember(id);
    setPullId(id);
  }, []);

  /** Asks Overhear for a pull of the last n calls and shows it. Starts from a clean screen: see start for a new one. */
  const begin = useCallback(
    async (n: number) => {
      asked.current = n;
      try {
        const res = await fetch("/api/pulls", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ n }), cache: "no-store" });
        const body: unknown = await res.json().catch(() => null);
        const id = typeof body === "object" && body !== null && typeof (body as { id?: unknown }).id === "string" ? (body as { id: string }).id : null;
        const error = typeof body === "object" && body !== null ? (body as { error?: unknown }).error : undefined;
        if (res.status === 401) return onDisconnected("bad_key");
        if (res.status === 409 && error === "not_connected") return onDisconnected(undefined);
        if ((res.status === 202 || (res.status === 409 && error === "pull_running")) && id) return adopt(id);
        setStartFailed(true);
      } catch {
        setStartFailed(true);
      }
    },
    [adopt, onDisconnected],
  );

  /** Clears what the last pull left on screen, then begins a new one. */
  const start = useCallback(
    (n: number) => {
      current.current = null;
      remember(null);
      setCount(n);
      setPullId(null);
      setProgress(null);
      setStartFailed(false);
      setUnreachable(false);
      setRetried(new Set());
      return begin(n);
    },
    [begin],
  );

  /** Reads one answer for a pull. "active" means ask again; "settled" means the pull is over or this screen moved on. */
  const load = useCallback(
    async (id: string): Promise<"active" | "settled"> => {
      let res: Response;
      try {
        res = await fetch(`/api/pulls/${encodeURIComponent(id)}`, { cache: "no-store" });
      } catch {
        if (current.current === id) setUnreachable(true);
        return "active";
      }
      if (current.current !== id) return "settled";
      if (res.status === 401) {
        onDisconnected("bad_key");
        return "settled";
      }
      if (res.status === 404) {
        // Overhear restarted, or the pull was dropped: begin a new one.
        void start(asked.current);
        return "settled";
      }
      const body: unknown = await res.json().catch(() => null);
      if (current.current !== id) return "settled";
      if (!res.ok || !isProgress(body)) {
        setUnreachable(true);
        return "active";
      }
      setUnreachable(false);
      asked.current = body.requested;
      setCount(body.requested);
      setProgress(body);
      setClock(now());
      if (body.phase === "failed" && body.error?.code === "bad_key") {
        onDisconnected("bad_key");
        return "settled";
      }
      return isActive(body) ? "active" : "settled";
    },
    [now, onDisconnected, start],
  );

  // On first show: this tab's pull if the server still has it, else a new pull of the last 25. The browser's
  // storage cannot be read while the page is rendered on the server, so this waits for the first render to be on screen.
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    queueMicrotask(() => {
      const earlier = remembered();
      if (earlier === null) {
        void begin(DEFAULT_COUNT);
        return;
      }
      current.current = earlier;
      setPullId(earlier);
    });
  }, [begin]);

  // Poll while the pull is running. Each new pull gets its own loop; the old one stops.
  useEffect(() => {
    if (pullId === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const next = await load(pullId);
      if (live && next === "active") timer = setTimeout(tick, pollMs);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [pullId, pollMs, load]);

  // The countdown in a pause moves each second between polls.
  const waitingUntil = progress?.waitingUntil ?? null;
  useEffect(() => {
    if (waitingUntil === null) return;
    const timer = setInterval(() => setClock(now()), 1000);
    return () => clearInterval(timer);
  }, [waitingUntil, now]);

  const active = isActive(progress) || (pullId === null && !startFailed && progress === null);

  async function stop() {
    const id = current.current;
    if (id === null || stopping) return;
    setStopping(true);
    try {
      await fetch(`/api/pulls/${encodeURIComponent(id)}/cancel`, { method: "POST", cache: "no-store" });
    } catch {
      // The next poll says what the pull is doing.
    }
    await load(id);
    setStopping(false);
  }

  async function retry(callId: string) {
    setRetrying((set) => new Set(set).add(callId));
    try {
      const res = await fetch(`/api/calls/${encodeURIComponent(callId)}/refetch`, { method: "POST", cache: "no-store" });
      if (res.status === 401) return onDisconnected("bad_key");
    } catch {
      // The row stays as it was.
    }
    setRetried((set) => new Set(set).add(callId));
    if (current.current !== null) await load(current.current);
    setRetrying((set) => {
      const next = new Set(set);
      next.delete(callId);
      return next;
    });
  }

  const beforeDisconnect = useCallback(async () => {
    const id = current.current;
    if (id === null || !isActive(progress)) return;
    try {
      await fetch(`/api/pulls/${encodeURIComponent(id)}/cancel`, { method: "POST", cache: "no-store" });
    } catch {
      // The key is removed either way.
    }
  }, [progress]);

  const rows = progress?.rows ?? [];
  const counts = countRows(rows);
  const say = headlineFor(progress, counts, count, startFailed);
  const failedOutright = startFailed || progress?.phase === "failed";
  const { attention, rest } = splitRows(rows);
  const settled = !active;
  const processed = counts.total - counts.pending;
  // Calls with no transcript, and (once the pull is over) calls it never reached: nothing was checked for any of them.
  const notChecked = counts.noContent + (settled ? counts.pending : 0);
  const pause = waitingUntil !== null && isActive(progress) ? LIST_WORDS.slowDown(secondsLeft(waitingUntil, clock)) : null;

  const renderRows = (list: typeof rows) =>
    list.map((row) => (
      <CallRow
        key={row.callId}
        row={row}
        timeZone={timeZone}
        settled={settled}
        retrying={retrying.has(row.callId)}
        retryFailed={retried.has(row.callId) && row.state === "error"}
        onRetry={retry}
      />
    ));

  return (
    <div className="report min-h-screen bg-report-canvas font-sans text-report-ink">
      <div className="mx-auto max-w-[1200px] px-4 pb-24 pt-6 sm:px-6">
        <ConnectionBar
          location={location}
          beforeDisconnect={beforeDisconnect}
          onDisconnected={() => onDisconnected(undefined)}
        />
        <main>
          <h1 className="max-w-[760px] font-display text-[26px] font-semibold leading-[1.2] tracking-[-0.01em] sm:text-[32px] sm:tracking-[-0.02em]">
            {say.lead}
            {say.next ? <> <span className="text-report-muted">{say.next}</span></> : null}
          </h1>

          {isActive(progress) && counts.total > 0 ? (
            <div
              role="progressbar"
              aria-label={LIST_WORDS.progressLabel}
              aria-valuemin={0}
              aria-valuemax={counts.total}
              aria-valuenow={processed}
              className="mt-6 h-1 max-w-[760px] overflow-hidden rounded-full bg-report-calm-mark"
            >
              <div className="h-full bg-report-accent motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${(processed / counts.total) * 100}%` }} />
            </div>
          ) : null}

          <div role="status" className="mt-4 text-sm empty:mt-0">
            {pause || unreachable ? (
              <p className="flex gap-2 text-report-warning">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span className="font-semibold">{pause ?? CONNECT_WORDS.serverDown}</span>
              </p>
            ) : null}
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-x-8 gap-y-4">
            {counts.total > 0 ? (
              <div role="group" aria-label={LIST_WORDS.summaryLabel} className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span className="text-report-ink-2">{LIST_WORDS.total(counts.total)}</span>
                <Count label={VERDICT_LABEL.failed} n={counts.failed} tone="critical" />
                <Count label={VERDICT_LABEL.needs_review} n={counts.needsReview} tone="warning" />
                <Count label={VERDICT_LABEL.passed} n={counts.passed} />
                {counts.nothingDone > 0 ? <Count label={VERDICT_LABEL.nothing_done} n={counts.nothingDone} /> : null}
                {notChecked > 0 ? <Count label={RESULT_LABEL.not_run} n={notChecked} /> : null}
                {counts.errored > 0 ? <Count label={LIST_WORDS.couldntLoad} n={counts.errored} tone="warning" /> : null}
              </div>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span id="count-label" className="text-[13px] text-report-muted">
                {LIST_WORDS.choiceLabel}
              </span>
              <div role="group" aria-labelledby="count-label" className="flex overflow-hidden rounded-md border border-report-line-strong bg-report-surface">
                {CHOICES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={count === n}
                    disabled={active}
                    onClick={() => void start(n)}
                    className={`min-h-11 min-w-12 px-3 text-sm font-semibold tabular-nums focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default ${
                      count === n ? "bg-report-accent-tint text-report-accent" : "text-report-ink-2 enabled:hover:bg-report-calm-mark"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              {active ? (
                <button type="button" onClick={() => void stop()} disabled={stopping} className={BUTTON}>
                  {stopping ? (
                    <>
                      <span aria-hidden className="report-delayed inline-flex">
                        <Loader2 className="size-4 motion-safe:animate-spin" />
                      </span>
                      {LIST_WORDS.stopping}
                    </>
                  ) : (
                    LIST_WORDS.stop
                  )}
                </button>
              ) : (
                <button type="button" onClick={() => void start(count)} className={BUTTON}>
                  {failedOutright ? LIST_WORDS.tryAgain : LIST_WORDS.checkAgain}
                </button>
              )}
            </div>
          </div>

          {rows.length > 0 ? (
            <div className="-mx-3 mt-6">
              {attention.length > 0 ? (
                <>
                  <h2 className="mb-1 px-3 text-sm font-semibold">{LIST_WORDS.attentionHeading}</h2>
                  <ul aria-label={LIST_WORDS.attentionHeading} className="border-y border-report-line bg-report-surface">
                    {renderRows(attention)}
                  </ul>
                </>
              ) : null}
              {rest.length > 0 ? (
                <>
                  {attention.length > 0 ? <h2 className="mb-1 mt-8 px-3 text-sm font-semibold">{LIST_WORDS.restHeading}</h2> : null}
                  <ul aria-label={attention.length > 0 ? LIST_WORDS.restHeading : LIST_WORDS.listLabel} className="border-y border-report-line bg-report-surface">
                    {renderRows(rest)}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}

          {progress && progress.skipped > 0 ? <p className="mt-4 text-[13px] text-report-muted">{LIST_WORDS.skipped(progress.skipped)}</p> : null}
        </main>
      </div>
    </div>
  );
}
