// A report that fails the schema is never rendered: not its verdict, not a part of it. This says so plainly,
// says what to do, and lists the first things that failed behind a disclosure.
import { UNREADABLE } from "@/report/labels";

const SHOWN = 5;

export function UnreadableView({ callId, problems }: { callId: string; problems: string[] }) {
  const shown = problems.slice(0, SHOWN);
  const hasMore = problems.length > SHOWN;
  return (
    <div>
      <h1 className="max-w-[34ch] text-2xl font-semibold leading-[1.2] tracking-[-0.01em] sm:text-[28px]">{UNREADABLE.title}</h1>
      <p className="mt-4 max-w-[62ch] break-words text-base">{UNREADABLE.detail(callId)}</p>
      <p className="mt-2 max-w-[62ch] text-base text-report-ink-2">{UNREADABLE.next}</p>
      {problems.length > 0 ? (
        <details className="mt-6">
          <summary className="inline-block cursor-pointer rounded py-1 text-sm text-report-muted hover:text-report-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent">
            {UNREADABLE.problems}
          </summary>
          <ul className="mt-2 space-y-1 rounded-md border border-report-line bg-report-surface p-3 font-mono text-[12px] leading-relaxed text-report-ink-2">
            {shown.map((p, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                {p}
              </li>
            ))}
          </ul>
          {hasMore ? <p className="mt-2 text-[13px] text-report-muted">{UNREADABLE.count(problems.length, SHOWN)}</p> : null}
        </details>
      ) : null}
    </div>
  );
}
