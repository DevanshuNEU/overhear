// How the call sounded to the caller, under the verdict. It never changes the verdict: a problem here is a
// sentence the engine wrote and a link to the first agent turn it rests on, in plain ink with no status colour.
// Only the checks that ran are named, so "no problems found" says what it rests on. No check ran, nothing shows.
import { useId } from "react";
import type { CallReport } from "@/report/schema";
import { SHOW_IN_CALL, experienceChecked, experienceLine } from "@/report/labels";

const LINK =
  "mt-0.5 block w-fit rounded py-1 text-[13px] text-report-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent";

function Problem({ text, first }: { text: string; first: number }) {
  const id = useId();
  return (
    <li className="max-w-[62ch] break-words text-sm leading-snug text-report-ink">
      <span id={id}>{text}</span>
      {Number.isFinite(first) ? (
        <a href={`#item-${first}`} aria-describedby={id} className={LINK}>
          {SHOW_IN_CALL}
        </a>
      ) : null}
    </li>
  );
}

export function ExperienceSection({ report }: { report: CallReport }) {
  const headingId = useId();
  const { ran, problems } = report.experience;
  if (ran.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="mt-4">
      <h2 id={headingId} className={`text-sm ${problems.length > 0 ? "font-semibold text-report-ink" : "text-report-ink-2"}`}>
        {experienceLine(problems.length)}
      </h2>
      {problems.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {problems.map((p, i) => (
            <Problem key={i} text={p.text} first={Math.min(...p.seqs)} />
          ))}
        </ul>
      ) : null}
      <p className="mt-2 max-w-[62ch] text-[13px] leading-snug text-report-muted">{experienceChecked(ran)}</p>
    </section>
  );
}
