// The gaps a finding names, in words. Each links to its detail under "What's missing" when the evidence lists it.
import { TriangleAlert } from "lucide-react";
import type { Evidence, Finding } from "@/report/schema";
import { GAP_LABEL } from "@/report/labels";
import { gapAnchor } from "./threads";

export function GapLines({ finding, evidence }: { finding: Finding; evidence: Evidence }) {
  if (finding.gaps.length === 0) return null;
  const cited = new Set([...finding.said, ...finding.did]);
  return (
    <ul className="mt-2 space-y-1">
      {finding.gaps.map((code) => {
        // Prefer the gap that touches what this finding cites; else the first of that kind.
        const at = evidence.gaps.findIndex((g) => g.code === code && g.seqs.some((s) => cited.has(s)));
        const index = at >= 0 ? at : evidence.gaps.findIndex((g) => g.code === code);
        return (
          <li key={code} className="flex items-start gap-2 text-sm text-report-warning">
            <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" strokeWidth={2.5} />
            {index >= 0 ? (
              <a href={`#${gapAnchor(index)}`} className="inline-block py-0.5 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent">
                {GAP_LABEL[code]}
              </a>
            ) : (
              <span>{GAP_LABEL[code]}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
