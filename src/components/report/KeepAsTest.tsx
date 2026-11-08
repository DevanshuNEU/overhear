"use client";

// "Keep as a test" on a call report (local mode only; the call screen and the test call result both render it, the hosted
// demo never does). It is two parts that share one state, so the report's header can place them apart:
//   - KeepAction: one quiet action in the header row beside the verdict. "Keep as a test"; once kept, "Kept as a test" and
//     Remove. It takes no room from the verdict and its sentence.
//   - KeepPanel: closed until the action is clicked, then it opens under the facts. It lists what Overhear said about the call:
//     the verdict, always kept, then the rules and call experience checks with the ones that matter ticked (keepModel.ts says
//     which). Keeping posts to /api/pins with what is ticked and what the screen showed, and the server refuses when the call
//     reads differently now. Every refusal is worded by the server (src/pull/labels.ts) and shown as it arrives.
// A call that is already kept reads "Kept as a test" with Remove, on load too. KeepAsTest is the two parts in a row, for a
// place that has no header to split across.
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { CONTRACT_TITLE, EXPERIENCE_TITLE, KEEP_NOTE_MAX, KEEP_WORDS, capitalize } from "@/report/labels";
import type { CallReport } from "@/report/schema";
import { keepItemsOf, pinBody, startTicks, tickKey, type KeepItems } from "./keepModel";
import { ResultBadge, VerdictBadge } from "./StatusBadge";

type Phase = "closed" | "open" | "saving" | "kept" | "removing";
type Failure = { code: string; message: string };
type Pins = "unknown" | "none" | "some";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-report-line-strong bg-report-surface px-4 text-sm font-semibold enabled:hover:bg-report-calm-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:text-report-ink-2";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-report-accent px-4 text-sm font-semibold text-white enabled:hover:bg-report-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:opacity-70";
// The quiet action: text in the accent, the look of the back link, no box.
const QUIET =
  "inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-report-accent underline-offset-2 enabled:hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:text-report-ink-2";

const JSON_HEADERS = { "content-type": "application/json" };
/** The id of the panel the action opens, for aria-controls. One report is on a page. */
const PANEL_ID = "keep-panel";

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** What a refusal says: the server's code and sentence, or a plain line when the answer is not one. */
async function failureOf(res: Response): Promise<Failure> {
  const body: unknown = await res.json().catch(() => null);
  if (isRec(body) && typeof body.message === "string") return { code: typeof body.error === "string" ? body.error : "failed", message: body.message };
  return { code: "failed", message: KEEP_WORDS.unreachable };
}

function Spin() {
  return (
    <span aria-hidden className="report-delayed inline-flex">
      <Loader2 className="size-4 motion-safe:animate-spin" />
    </span>
  );
}

function useKeep(report: CallReport) {
  const items: KeepItems = keepItemsOf(report);
  const [phase, setPhase] = useState<Phase>("closed");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => startTicks(items));
  const [note, setNote] = useState("");
  const [pins, setPins] = useState<Pins>("unknown");
  const [pinId, setPinId] = useState<string | null>(null);
  const [justKept, setJustKept] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const callId = report.callId;
  // Where focus is, and where it goes next: the action (the one in the header row), the panel's heading, the panel's Keep.
  const actionRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const focusActionRef = useRef(false);
  const focusPanelRef = useRef(false);
  const focusSubmitRef = useRef(false);

  // Whether this call is kept already, and whether anything is kept at all (the first keep carries a warning). Until the
  // answer comes, or if it never does, the warning shows: it is the safe thing to say.
  useEffect(() => {
    let live = true;
    fetch("/api/pins", { cache: "no-store" })
      .then(async (res) => {
        const body: unknown = res.ok ? await res.json().catch(() => null) : null;
        if (!live || !isRec(body) || !Array.isArray(body.pins)) return;
        const mine = body.pins.find((p): p is { id: string; callId: string } => isRec(p) && p.callId === callId && typeof p.id === "string");
        setPins(body.pins.length === 0 ? "none" : "some");
        if (mine) {
          setPinId(mine.id);
          setPhase((now) => (now === "closed" ? "kept" : now));
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [callId]);

  function toggle(key: string) {
    setTicked((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function keep() {
    setPhase("saving");
    setFailure(null);
    try {
      const res = await fetch("/api/pins", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(pinBody(callId, items, ticked, note)), cache: "no-store" });
      if (res.ok) {
        const body: unknown = await res.json().catch(() => null);
        setPinId(isRec(body) && typeof body.id === "string" ? body.id : null);
        setPins("some");
        setJustKept(true);
        focusActionRef.current = true;
        setPhase("kept");
        return;
      }
      setFailure(await failureOf(res));
    } catch {
      setFailure({ code: "unreachable", message: KEEP_WORDS.unreachable });
    }
    focusSubmitRef.current = true;
    setPhase("open");
  }

  async function remove() {
    if (pinId === null) return;
    setPhase("removing");
    setFailure(null);
    try {
      const res = await fetch(`/api/pins/${encodeURIComponent(pinId)}`, { method: "DELETE", cache: "no-store" });
      if (res.ok) {
        setPinId(null);
        setJustKept(false);
        focusActionRef.current = true;
        setPhase("closed");
        return;
      }
      setFailure(await failureOf(res));
    } catch {
      setFailure({ code: "unreachable", message: KEEP_WORDS.unreachable });
    }
    focusActionRef.current = true;
    setPhase("kept");
  }

  /** Opens the panel and moves focus to its heading. */
  function openPanel() {
    focusPanelRef.current = true;
    setPhase("open");
  }
  /** Closes the panel from the action, which keeps focus. */
  function close() {
    setPhase("closed");
  }
  /** Closes the panel from Cancel, which is about to go, so focus returns to the action. */
  function cancel() {
    focusActionRef.current = true;
    setPhase("closed");
  }

  return { callId, items, phase, openPanel, close, cancel, ticked, toggle, note, setNote, pins, pinId, justKept, failure, keep, remove, actionRef, headingRef, submitRef, focusActionRef, focusPanelRef, focusSubmitRef };
}

type Keep = ReturnType<typeof useKeep>;
const KeepContext = createContext<Keep | null>(null);

function useKeepContext(): Keep {
  const keep = useContext(KeepContext);
  if (!keep) throw new Error("keep-no-provider");
  return keep;
}

export function KeepProvider({ report, children }: { report: CallReport; children: ReactNode }) {
  return <KeepContext.Provider value={useKeep(report)}>{children}</KeepContext.Provider>;
}

/** The quiet action: Keep as a test, or, once kept, Kept as a test with Remove. Nothing while the panel is open. */
export function KeepAction() {
  const k = useKeepContext();
  const { actionRef, focusActionRef } = k;
  // Focus goes back to the action after Cancel, a keep and a remove: the control it was on has just changed or gone.
  useEffect(() => {
    if (focusActionRef.current) {
      focusActionRef.current = false;
      actionRef.current?.focus();
    }
  });
  const kept = k.phase === "kept" || k.phase === "removing";
  const open = k.phase === "open" || k.phase === "saving";
  return (
    <span className="inline-flex items-center gap-1">
      {/* On the page before anything is kept, so a screen reader announces the words when they arrive. */}
      <span role="status" aria-label={KEEP_WORDS.open}>
        {kept ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-medium text-report-ink-2">
            <Check aria-hidden className="size-4 text-report-accent" strokeWidth={2.5} />
            {KEEP_WORDS.kept}
          </span>
        ) : null}
      </span>
      {kept ? (
        <button ref={actionRef} type="button" onClick={() => void k.remove()} disabled={k.phase === "removing" || k.pinId === null} className={QUIET}>
          {k.phase === "removing" ? (
            <>
              <Spin />
              {KEEP_WORDS.removing}
            </>
          ) : (
            KEEP_WORDS.remove
          )}
        </button>
      ) : (
        <button
          ref={actionRef}
          type="button"
          onClick={open ? k.close : k.openPanel}
          disabled={k.phase === "saving"}
          aria-expanded={open}
          aria-controls={open ? PANEL_ID : undefined}
          className={QUIET}
        >
          {KEEP_WORDS.open}
        </button>
      )}
    </span>
  );
}

/** Where it was saved right after a keep, a refusal to remove, and, when the action is open, the list of what to keep. */
export function KeepPanel() {
  const k = useKeepContext();
  const noteId = useId();
  const noteHintId = useId();
  const { items, callId, failure, headingRef, submitRef, focusPanelRef, focusSubmitRef } = k;
  // Opening the panel moves focus to its heading; a refused keep puts it back on Keep, which was disabled while it was sent.
  useEffect(() => {
    if (focusPanelRef.current && headingRef.current) {
      focusPanelRef.current = false;
      headingRef.current.focus();
    } else if (focusSubmitRef.current && submitRef.current) {
      focusSubmitRef.current = false;
      submitRef.current.focus();
    }
  });

  const alert = failure ? (
    <div role="alert" className="mt-4 text-sm">
      <p className="flex gap-2 font-semibold text-report-critical">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{failure.message}</span>
      </p>
      {failure.code === "changed" ? (
        <a href={`/reports/${encodeURIComponent(callId)}`} className="mt-1 inline-flex min-h-11 items-center pl-6 font-medium text-report-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent">
          {KEEP_WORDS.reload}
        </a>
      ) : null}
    </div>
  ) : null;

  if (k.phase === "closed") return null;
  if (k.phase === "kept" || k.phase === "removing") {
    return k.justKept || alert ? (
      <div className="mt-2">
        {k.justKept ? <p className="text-[13px] text-report-muted">{KEEP_WORDS.keptWhere}</p> : null}
        {alert}
      </div>
    ) : null;
  }

  const saving = k.phase === "saving";
  const row = "flex min-h-11 cursor-pointer items-center gap-3 py-1.5 text-sm";
  const box = "size-4 shrink-0 accent-report-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent";
  return (
    <section id={PANEL_ID} aria-labelledby="keep-heading" className="mt-6 max-w-[640px] border-t border-report-line pt-6">
      <h2 id="keep-heading" ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
        {KEEP_WORDS.heading}
      </h2>
      <p className="mt-1 text-sm text-report-ink-2">{KEEP_WORDS.intro}</p>

      <div className="mt-5 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{KEEP_WORDS.verdictLabel}</span>
        <VerdictBadge verdict={items.verdict} />
        <span className="text-[13px] text-report-muted">{KEEP_WORDS.alwaysKept}</span>
      </div>

      {items.contracts.length > 0 ? (
        <fieldset disabled={saving} className="mt-4">
          <legend className="text-sm font-semibold">{KEEP_WORDS.rulesHeading}</legend>
          <ul className="mt-1">
            {items.contracts.map((c) => (
              <li key={c.id}>
                <label className={row}>
                  <input type="checkbox" className={box} checked={k.ticked.has(tickKey("contracts", c.id))} onChange={() => k.toggle(tickKey("contracts", c.id))} />
                  <span className="min-w-0 flex-1">{capitalize(CONTRACT_TITLE[c.id])}</span>
                  <ResultBadge result={c.result} />
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {items.experience.length > 0 ? (
        <fieldset disabled={saving} className="mt-4">
          <legend className="text-sm font-semibold">{KEEP_WORDS.experienceHeading}</legend>
          <ul className="mt-1">
            {items.experience.map((c) => (
              <li key={c.id}>
                <label className={row}>
                  <input type="checkbox" className={box} checked={k.ticked.has(tickKey("experience", c.id))} onChange={() => k.toggle(tickKey("experience", c.id))} />
                  <span className="min-w-0 flex-1">{capitalize(EXPERIENCE_TITLE[c.id])}</span>
                  <span className={`text-[13px] ${c.result === "problem" ? "font-medium text-report-ink" : "text-report-muted"}`}>{c.result === "problem" ? KEEP_WORDS.problem : KEEP_WORDS.noProblem}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      <div className="mt-5">
        <label htmlFor={noteId} className="text-sm font-semibold">
          {KEEP_WORDS.noteLabel}
        </label>
        <input
          id={noteId}
          type="text"
          value={k.note}
          maxLength={KEEP_NOTE_MAX}
          disabled={saving}
          onChange={(e) => k.setNote(e.target.value.replace(/[\r\n]+/g, " "))}
          aria-describedby={noteHintId}
          className="mt-1 block min-h-11 w-full rounded-md border border-report-line-strong bg-report-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent"
        />
        <p id={noteHintId} className="mt-1 flex justify-between gap-4 text-[13px] text-report-muted">
          <span>{KEEP_WORDS.noteHint}</span>
          {k.note.length >= KEEP_NOTE_MAX - 40 ? <span className="tabular-nums">{KEEP_WORDS.noteCount(k.note.length, KEEP_NOTE_MAX)}</span> : null}
        </p>
      </div>

      {k.pins !== "some" ? (
        <p className="mt-5 flex gap-2 text-sm text-report-ink-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-report-warning" />
          <span>{KEEP_WORDS.firstPin}</span>
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button ref={submitRef} type="button" onClick={() => void k.keep()} disabled={saving} className={PRIMARY}>
          {saving ? (
            <>
              <Spin />
              {KEEP_WORDS.keeping}
            </>
          ) : (
            KEEP_WORDS.keep
          )}
        </button>
        <button
          type="button"
          onClick={k.cancel}
          disabled={saving}
          className={BUTTON}
        >
          {KEEP_WORDS.cancel}
        </button>
      </div>
      {alert}
    </section>
  );
}

/** The action and the panel stacked, for a place with no header to split them across. */
export function KeepAsTest({ report }: { report: CallReport }) {
  return (
    <KeepProvider report={report}>
      <div>
        <KeepAction />
      </div>
      <KeepPanel />
    </KeepProvider>
  );
}
