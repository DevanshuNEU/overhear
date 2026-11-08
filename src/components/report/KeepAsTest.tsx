"use client";

// "Keep as a test" on a call report (local mode only; the call screen and the test call result both render it, the hosted
// demo never does). It starts as one button. Opened, it lists what Overhear said about the call: the verdict, always kept,
// then the rules and call experience checks with the ones that matter ticked (keepModel.ts says which). Keeping posts to
// /api/pins with what is ticked and what the screen showed, and the server refuses when the call reads differently now.
// Every refusal is worded by the server (src/pull/labels.ts) and shown as it arrives. A call that is already kept reads
// "Kept as a test" with Remove, on load too.
import { useEffect, useId, useState } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { CONTRACT_TITLE, EXPERIENCE_TITLE, capitalize } from "@/report/labels";
import type { CallReport } from "@/report/schema";
import { keepItemsOf, pinBody, startTicks, tickKey, type KeepItems } from "./keepModel";
import { KEEP_NOTE_MAX as PIN_NOTE_MAX, KEEP_WORDS } from "@/report/labels";
import { ResultBadge, VerdictBadge } from "./StatusBadge";

type Phase = "closed" | "open" | "saving" | "kept" | "removing";
type Failure = { code: string; message: string };
type Pins = "unknown" | "none" | "some";

const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-report-line-strong bg-report-surface px-4 text-sm font-semibold enabled:hover:bg-report-calm-mark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:text-report-ink-2";
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-report-accent px-4 text-sm font-semibold text-white enabled:hover:bg-report-accent/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent disabled:cursor-default disabled:opacity-70";

const JSON_HEADERS = { "content-type": "application/json" };

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

export function KeepAsTest({ report }: { report: CallReport }) {
  const items: KeepItems = keepItemsOf(report);
  const [phase, setPhase] = useState<Phase>("closed");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => startTicks(items));
  const [note, setNote] = useState("");
  const [pins, setPins] = useState<Pins>("unknown");
  const [pinId, setPinId] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const noteId = useId();
  const noteHintId = useId();

  // Whether this call is kept already, and whether anything is kept at all (the first keep carries a warning). Until the
  // answer comes, or if it never does, the warning shows: it is the safe thing to say.
  const callId = report.callId;
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
        setPhase("kept");
        return;
      }
      setFailure(await failureOf(res));
    } catch {
      setFailure({ code: "unreachable", message: KEEP_WORDS.unreachable });
    }
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
        setPhase("closed");
        return;
      }
      setFailure(await failureOf(res));
    } catch {
      setFailure({ code: "unreachable", message: KEEP_WORDS.unreachable });
    }
    setPhase("kept");
  }

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

  if (phase === "kept" || phase === "removing") {
    return (
      <div className="mt-6">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Check aria-hidden className="size-4 text-report-accent" strokeWidth={2.5} />
            {KEEP_WORDS.kept}
          </p>
          <p className="text-[13px] text-report-muted">{KEEP_WORDS.keptWhere}</p>
          <button type="button" onClick={() => void remove()} disabled={phase === "removing" || pinId === null} className={BUTTON}>
            {phase === "removing" ? (
              <>
                <Spin />
                {KEEP_WORDS.removing}
              </>
            ) : (
              KEEP_WORDS.remove
            )}
          </button>
        </div>
        {alert}
      </div>
    );
  }

  if (phase === "closed") {
    return (
      <div className="mt-6">
        <button type="button" onClick={() => setPhase("open")} aria-expanded="false" className={BUTTON}>
          {KEEP_WORDS.open}
        </button>
      </div>
    );
  }

  const saving = phase === "saving";
  const row = "flex min-h-11 cursor-pointer items-center gap-3 py-1.5 text-sm";
  const box = "size-4 shrink-0 accent-report-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent";
  return (
    <section aria-labelledby="keep-heading" className="mt-8 max-w-[640px] border-t border-report-line pt-6">
      <h2 id="keep-heading" className="text-base font-semibold">
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
                  <input type="checkbox" className={box} checked={ticked.has(tickKey("contracts", c.id))} onChange={() => toggle(tickKey("contracts", c.id))} />
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
                  <input type="checkbox" className={box} checked={ticked.has(tickKey("experience", c.id))} onChange={() => toggle(tickKey("experience", c.id))} />
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
          value={note}
          maxLength={PIN_NOTE_MAX}
          disabled={saving}
          onChange={(e) => setNote(e.target.value.replace(/[\r\n]+/g, " "))}
          aria-describedby={noteHintId}
          className="mt-1 block min-h-11 w-full rounded-md border border-report-line-strong bg-report-surface px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent"
        />
        <p id={noteHintId} className="mt-1 flex justify-between gap-4 text-[13px] text-report-muted">
          <span>{KEEP_WORDS.noteHint}</span>
          {note.length >= PIN_NOTE_MAX - 40 ? <span className="tabular-nums">{KEEP_WORDS.noteCount(note.length, PIN_NOTE_MAX)}</span> : null}
        </p>
      </div>

      {pins !== "some" ? (
        <p className="mt-5 flex gap-2 text-sm text-report-ink-2">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-report-warning" />
          <span>{KEEP_WORDS.firstPin}</span>
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void keep()} disabled={saving} className={PRIMARY}>
          {saving ? (
            <>
              <Spin />
              {KEEP_WORDS.keeping}
            </>
          ) : (
            KEEP_WORDS.keep
          )}
        </button>
        <button type="button" onClick={() => setPhase("closed")} disabled={saving} className={BUTTON}>
          {KEEP_WORDS.cancel}
        </button>
      </div>
      {alert}
    </section>
  );
}
