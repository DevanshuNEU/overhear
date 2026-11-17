"use client";

// Under the shell on a local call report: the way back to the list the person came from, and Previous and Next to
// move along that list without going back. The list is the one the call list last showed: its pull id is in the
// tab's session, so the rows are fetched once here and cut by the same filter (callListModel) the list used.
// With no pull, a failed fetch, or a call that is not in the pull, only the way back shows. J and K step too, when
// the person is not typing. The pull id is not secret and nothing here touches the key.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import type { PullRow } from "@/pull/pull";
import { filterRows, parseFilter, type Filter } from "@/app/callListModel";
import { STEP_LABEL } from "@/report/labels";

const REMEMBER = "overhear.pull";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent";
const ITEM = `inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium ${FOCUS}`;

const listHref = (from: Filter) => (from === "all" ? "/" : `/?show=${from}`);
const reportHref = (callId: string, from: Filter) => `/reports/${encodeURIComponent(callId)}${from === "all" ? "" : `?from=${from}`}`;

function rememberedPull(): string | null {
  try {
    return window.sessionStorage.getItem(REMEMBER);
  } catch {
    return null;
  }
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
};

export function CallSteps({ samples }: Props = {}) {
  const router = useRouter();
  const params = useParams<{ callId?: string }>();
  const from = parseFilter(useSearchParams()?.get("from"));
  const callId = typeof params?.callId === "string" ? params.callId : null;
  const [pulled, setRows] = useState<PullRow[] | null>(null);
  const hosted = samples !== undefined;
  const rows = samples ?? pulled;

  // One read of the pull, when the report opens. A failure leaves only the way back. A hosted copy has no pull.
  useEffect(() => {
    if (hosted) return;
    const id = rememberedPull();
    if (id === null) return;
    let live = true;
    fetch(`/api/pulls/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        const found = typeof body === "object" && body !== null ? (body as { rows?: unknown }).rows : undefined;
        if (live && isRows(found)) setRows(found);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [hosted]);

  const steps = useMemo(() => {
    if (rows === null || callId === null) return null;
    // Only calls with a report can be opened, so only they are steps.
    const list = filterRows(rows, from).filter((r) => r.state === "report");
    const at = list.findIndex((r) => r.callId === callId);
    if (at === -1) return null;
    return { previous: list[at - 1]?.callId ?? null, next: list[at + 1]?.callId ?? null };
  }, [rows, callId, from]);

  const previousHref = steps?.previous ? reportHref(steps.previous, from) : null;
  const nextHref = steps?.next ? reportHref(steps.next, from) : null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || typing(e.target)) return;
      const key = e.key.toLowerCase();
      const href = key === "j" ? nextHref : key === "k" ? previousHref : null;
      if (href === null) return;
      e.preventDefault();
      router.push(href);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextHref, previousHref, router]);

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
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 sm:mb-3">
      <Link href={listHref(from)} className={`${ITEM} -ml-2 text-report-accent underline-offset-2 hover:underline`}>
        <Arrow dir="left" />
        {(hosted ? STEP_LABEL.backSamples : STEP_LABEL.back)[from]}
      </Link>
      {steps ? (
        <div className="flex items-center gap-x-2">
          {step(previousHref, STEP_LABEL.previous, STEP_LABEL.previousTitle, "left")}
          {step(nextHref, STEP_LABEL.next, STEP_LABEL.nextTitle, "right")}
        </div>
      ) : null}
    </div>
  );
}
