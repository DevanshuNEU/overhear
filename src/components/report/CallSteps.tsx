"use client";

// Under the shell on a local call report: the way back to the list the person came from, and Previous and Next to
// move along that list without going back. The list is the one the call list last showed: its pull id is in the
// tab's session, so the rows are fetched once here and cut by the same filter (callListModel) the list used. A call
// opened from the files list (`?src=files`) takes its rows from /api/files instead.
// With no pull, a failed fetch, or a call that is not in the pull, only the way back shows. J and K step too, when
// the person is not typing. The pull id is not secret and nothing here touches the key.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { PullRow } from "@/pull/pull";
import { filterRows, parseFilter, type Filter } from "@/app/callListModel";
import { SHORTCUT_LABEL, STEP_LABEL, YOUR_CALL_LABEL } from "@/report/labels";

const REMEMBER = "overhear.pull";
const SHORTCUTS_KEY = "overhear.shortcuts";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent";
const ITEM = `inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium ${FOCUS}`;

const listHref = (from: Filter, files: boolean) => `${files ? "/files" : "/"}${from === "all" ? "" : `?show=${from}`}`;
const reportHref = (callId: string, from: Filter, files: boolean) => {
  const query = [files ? "src=files" : null, from === "all" ? null : `from=${from}`].filter(Boolean).join("&");
  return `/reports/${encodeURIComponent(callId)}${query ? `?${query}` : ""}`;
};

function rememberedPull(): string | null {
  try {
    return window.sessionStorage.getItem(REMEMBER);
  } catch {
    return null;
  }
}

/** Shortcuts are on unless the person turned them off. Storage can throw, and then they stay on. */
let held: boolean | null = null;
function shortcutsOn(): boolean {
  try {
    return window.localStorage.getItem(SHORTCUTS_KEY) !== "off";
  } catch {
    return held ?? true;
  }
}

// The choice is a store of its own, so the server and the first paint say "on" and the saved choice follows.
const watchers = new Set<() => void>();
function watchShortcuts(tell: () => void) {
  watchers.add(tell);
  window.addEventListener("storage", tell);
  return () => {
    watchers.delete(tell);
    window.removeEventListener("storage", tell);
  };
}

function saveShortcuts(on: boolean) {
  held = on;
  try {
    if (on) window.localStorage.removeItem(SHORTCUTS_KEY);
    else window.localStorage.setItem(SHORTCUTS_KEY, "off");
  } catch {
    // The choice holds for this page only.
  }
  watchers.forEach((tell) => tell());
}

function isRows(value: unknown): value is PullRow[] {
  return Array.isArray(value) && value.every((r) => typeof r === "object" && r !== null && typeof (r as PullRow).callId === "string" && typeof (r as PullRow).state === "string");
}

/** True when a key press belongs to something the person is typing into. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable || target.getAttribute("contenteditable") === "" || target.getAttribute("contenteditable") === "true";
}

function Arrow({ dir }: { dir: "left" | "right" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"} />
    </svg>
  );
}

type Props = {
  /** A hosted copy: the order comes from the server (the sample calls), nothing is fetched, and the words say sample calls. */
  samples?: PullRow[];
  /** The calls this visitor made on the demo. A report of one is not along the samples: no steps, and "Your call" in their place. */
  yourCalls?: readonly string[];
};

export function CallSteps({ samples, yourCalls = [] }: Props = {}) {
  const router = useRouter();
  const params = useParams<{ callId?: string }>();
  const search = useSearchParams();
  const from = parseFilter(search?.get("from"));
  // A call opened from the list of files (`src=files`) steps along that list, in the order /api/files gives.
  const files = search?.get("src") === "files";
  const callId = typeof params?.callId === "string" ? params.callId : null;
  const [pulled, setRows] = useState<PullRow[] | null>(null);
  const keys = useSyncExternalStore(watchShortcuts, shortcutsOn, () => true);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLElement | null>(null);
  const hosted = samples !== undefined;
  const rows = samples ?? pulled;
  const yours = callId !== null && yourCalls.includes(callId);

  // One read of the pull, when the report opens. A failure leaves only the way back. A hosted copy has no pull.
  useEffect(() => {
    if (hosted) return;
    const pull = files ? null : rememberedPull();
    if (!files && pull === null) return;
    let live = true;
    fetch(files ? "/api/files" : `/api/pulls/${encodeURIComponent(pull as string)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        const found = typeof body === "object" && body !== null ? (body as { rows?: unknown }).rows : undefined;
        if (live && isRows(found)) setRows(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hosted, files]);

  const steps = useMemo(() => {
    if (rows === null || callId === null || yours) return null;
    // Only calls with a report can be opened, so only they are steps.
    const list = filterRows(rows, from).filter((r) => r.state === "report");
    const at = list.findIndex((r) => r.callId === callId);
    if (at === -1) return null;
    return { previous: list[at - 1]?.callId ?? null, next: list[at + 1]?.callId ?? null };
  }, [rows, callId, from, yours]);

  const previousHref = steps?.previous ? reportHref(steps.previous, from, files) : null;
  const nextHref = steps?.next ? reportHref(steps.next, from, files) : null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((was) => {
          if (!was) before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          return true;
        });
        return;
      }
      if (e.shiftKey || !keys) return;
      const key = e.key.toLowerCase();
      const href = key === "j" ? nextHref : key === "k" ? previousHref : null;
      if (href === null) return;
      e.preventDefault();
      router.push(href);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, nextHref, previousHref, router]);

  function close() {
    setOpen(false);
    before.current?.focus();
    before.current = null;
  }

  // Open: focus moves in. Esc and a click outside close it, and focus goes back to where it was.
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }
    function onDown(e: MouseEvent) {
      if (e.target instanceof Node && dialog.current?.contains(e.target)) return;
      close();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  function toggleKeys() {
    saveShortcuts(!keys);
  }

  const step = (href: string | null, label: string, title: string, dir: "left" | "right") => {
    const inside = dir === "left" ? (
      <>
        <Arrow dir="left" />
        {label}
      </>
    ) : (
      <>
        {label}
        <Arrow dir="right" />
      </>
    );
    if (href === null) {
      return (
        <span role="link" aria-disabled="true" title={title} className={`${ITEM} cursor-default text-report-muted`}>
          {inside}
        </span>
      );
    }
    return (
      <Link href={href} title={title} className={`${ITEM} text-report-accent underline-offset-2 hover:underline`}>
        {inside}
      </Link>
    );
  };

  return (
    <div className="relative mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 sm:mb-3">
      <Link href={listHref(from, files)} className={`${ITEM} -ml-2 text-report-accent underline-offset-2 hover:underline`}>
        <Arrow dir="left" />
        {(hosted ? STEP_LABEL.backSamples : STEP_LABEL.back)[from]}
      </Link>
      {yours ? <p className="text-sm font-semibold">{YOUR_CALL_LABEL}</p> : null}
      {steps ? (
        <div className="flex items-center gap-x-2">
          {step(previousHref, STEP_LABEL.previous, keys ? STEP_LABEL.previousTitle : STEP_LABEL.previousTitleOff, "left")}
          {step(nextHref, STEP_LABEL.next, keys ? STEP_LABEL.nextTitle : STEP_LABEL.nextTitleOff, "right")}
        </div>
      ) : null}
      {open ? (
        <div
          ref={dialog}
          role="dialog"
          aria-label={SHORTCUT_LABEL.heading}
          tabIndex={-1}
          className="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border border-report-line-strong bg-report-surface p-4 text-report-ink shadow-md focus:outline-none"
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold">{SHORTCUT_LABEL.heading}</h2>
            <button type="button" onClick={close} className={`-mr-2 -mt-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-report-ink-2 ${FOCUS}`}>
              <span className="sr-only">{SHORTCUT_LABEL.close}</span>
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="m4 4 8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
          <dl className="mt-1 text-sm">
            {([["J", SHORTCUT_LABEL.next], ["K", SHORTCUT_LABEL.previous]] as const).map(([key, what]) => (
              <div key={key} className="flex items-center justify-between py-1">
                <dt>{what}</dt>
                <dd>
                  <kbd className="rounded border border-report-line-strong px-1.5 font-mono text-[13px]">{key}</kbd>
                </dd>
              </div>
            ))}
          </dl>
          <button type="button" onClick={toggleKeys} className={`mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-report-line-strong px-3 text-sm font-medium ${FOCUS}`}>
            {keys ? SHORTCUT_LABEL.turnOff : SHORTCUT_LABEL.turnOn}
          </button>
        </div>
      ) : null}
    </div>
  );
}
