// The lanes of a finding: what was asked, what the agent said, what the system did. Each lane is a
// list of seqs into the evidence, turned into plain lines. Raw payloads stay behind a disclosure.
import { useId } from "react";
import type { ReactNode } from "react";
import type { Detection, Evidence, Item } from "@/report/schema";
import { BACKEND_LOG_TAG, LANE_LABEL, NOTHING_DID, WHOLE_TURN } from "@/report/labels";
import { describeActions } from "./describe";
import { formatClock } from "./format";
import { markQuotes, windowAround } from "./highlight";
import { RawDetail } from "./RawDetail";

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
      {turns.map((t, i) => {
        const claim = quotes?.get(t.seq) ?? [];
        // Show the claim and the sentence either side. The whole turn waits behind a disclosure.
        const window = windowAround(t.text, claim);
        return (
          <div key={i} className="text-[15px] leading-relaxed">
            <p className="break-words">
              <Time sec={t.startSec} />
              <span data-preview>{markQuotes(window ? window.text : t.text, claim, markClass)}</span>
            </p>
            {window ? (
              <details className="mt-1">
                <summary className="inline-block cursor-pointer rounded py-0.5 text-[13px] text-report-muted hover:text-report-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent">
                  {WHOLE_TURN}
                </summary>
                <p className="mt-1 break-words text-report-ink-2">{markQuotes(t.text, claim, markClass)}</p>
              </details>
            ) : null}
          </div>
        );
      })}
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

/** What the system did, one line per action. A tool call and its result are one line, with the raw record on the same line. */
export function DidLane({ evidence, seqs, hideWhenEmpty = false, absence }: { evidence: Evidence; seqs: number[]; hideWhenEmpty?: boolean; absence?: ReactNode }) {
  const lines = describeActions(evidence, seqs);
  if (lines.length === 0 && hideWhenEmpty) return null;
  return (
    <Lane label={LANE_LABEL.did}>
      {lines.length === 0 ? (
        (absence ?? <p className="text-[15px] text-report-ink-2">{NOTHING_DID}</p>)
      ) : (
        <ol className="space-y-2">
          {lines.map((l, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span data-line className="min-w-0 [overflow-wrap:anywhere] text-[15px] leading-relaxed">
                {l.line}
              </span>
              {l.backend ? <span className="rounded bg-report-accent-tint px-1.5 text-[12px] text-report-accent">{BACKEND_LOG_TAG}</span> : null}
              <RawDetail raw={l.raw} inline />
            </li>
          ))}
        </ol>
      )}
    </Lane>
  );
}
