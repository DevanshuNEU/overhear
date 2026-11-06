// The lanes of a finding: what was asked, what the agent said, what the system did. Each lane is a
// list of seqs into the evidence, turned into plain lines. Raw payloads stay behind a disclosure.
import { useId } from "react";
import type { ReactNode } from "react";
import type { Detection, Evidence, Item } from "@/report/schema";
import {
  BACKEND_LOG_TAG,
  LANE_LABEL,
  NOTHING_DID,
  RAW_DETAIL_LABEL,
  backendActionLine,
  eventLine,
  toolCallLine,
  toolResultLine,
} from "@/report/labels";
import { formatClock } from "./format";
import { markQuotes } from "./highlight";

type Turn = Extract<Item, { kind: "turn" }>;

function itemsAt(evidence: Evidence, seqs: number[]): Item[] {
  const bySeq = new Map(evidence.items.map((it) => [it.seq, it]));
  return seqs.flatMap((s) => bySeq.get(s) ?? []);
}

function Lane({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="min-w-0">
      <p id={id} className="mb-2 text-[13px] font-medium text-report-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

function Time({ sec }: { sec: number | null }) {
  if (sec === null) return null;
  return <span className="mr-2 text-[13px] tabular-nums text-report-muted">{formatClock(sec)}</span>;
}

function Turns({ turns, quotes, markClass }: { turns: Turn[]; quotes?: Map<number, string[]>; markClass: string }) {
  return (
    <div className="space-y-3">
      {turns.map((t, i) => (
        <p key={i} className="break-words text-[15px] leading-relaxed">
          <Time sec={t.startSec} />
          {markQuotes(t.text, quotes?.get(t.seq) ?? [], markClass)}
        </p>
      ))}
    </div>
  );
}

const turnsOf = (items: Item[], role: Turn["role"]) => items.filter((it): it is Turn => it.kind === "turn" && it.role === role);

export function AskedLane({ evidence, seqs }: { evidence: Evidence; seqs: number[] }) {
  const turns = turnsOf(itemsAt(evidence, seqs), "caller");
  if (turns.length === 0) return null;
  return (
    <Lane label={LANE_LABEL.asked}>
      <Turns turns={turns} markClass="" />
    </Lane>
  );
}

export function SaidLane({
  evidence,
  seqs,
  detections,
  markClass,
}: {
  evidence: Evidence;
  seqs: number[];
  detections: Detection[];
  markClass: string;
}) {
  const turns = turnsOf(itemsAt(evidence, seqs), "agent");
  if (turns.length === 0) return null;
  const quotes = new Map<number, string[]>();
  for (const d of detections) quotes.set(d.seq, [...(quotes.get(d.seq) ?? []), d.quote]);
  return (
    <Lane label={LANE_LABEL.said}>
      <Turns turns={turns} quotes={quotes} markClass={markClass} />
    </Lane>
  );
}

/** The one line a thing the system did gets, and the raw record behind it. */
function didLine(item: Item, evidence: Evidence): { line: string; raw: unknown; backend: boolean } | null {
  const callName = (id: string) => {
    const call = evidence.items.find((x) => x.kind === "tool_call" && x.id === id);
    return call && call.kind === "tool_call" ? call.name : id;
  };
  switch (item.kind) {
    case "tool_call":
      return { line: toolCallLine(item.name), raw: item.args, backend: false };
    case "tool_result":
      return { line: toolResultLine(callName(item.id), item.ok), raw: item.payload, backend: false };
    case "backend_action":
      return { line: backendActionLine(item.tool, item.ok), raw: { args: item.args, result: item.result, ts: item.ts }, backend: true };
    case "event":
      return { line: eventLine(item.type), raw: item.data, backend: false };
    case "turn":
      return null;
  }
}

export function DidLane({ evidence, seqs }: { evidence: Evidence; seqs: number[] }) {
  const lines = itemsAt(evidence, seqs).flatMap((it) => {
    const l = didLine(it, evidence);
    return l ? [{ seq: it.seq, ...l }] : [];
  });
  return (
    <Lane label={LANE_LABEL.did}>
      {lines.length === 0 ? (
        <p className="text-[15px] text-report-ink-2">{NOTHING_DID}</p>
      ) : (
        <ol className="space-y-3">
          {lines.map((l, i) => (
            <li key={i}>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span data-line className="break-words text-[15px] leading-relaxed">
                  {l.line}
                </span>
                {l.backend ? <span className="rounded bg-report-accent-tint px-1.5 text-[12px] text-report-accent">{BACKEND_LOG_TAG}</span> : null}
              </div>
              {l.raw !== undefined && l.raw !== null ? (
                <details data-raw className="mt-1">
                  <summary className="inline-block cursor-pointer rounded py-0.5 text-[13px] text-report-muted hover:text-report-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent">
                    {RAW_DETAIL_LABEL}
                  </summary>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-report-line bg-report-canvas p-3 font-mono text-[12px] leading-relaxed text-report-ink-2">
                    {typeof l.raw === "string" ? l.raw : JSON.stringify(l.raw, null, 2)}
                  </pre>
                </details>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Lane>
  );
}
