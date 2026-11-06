// The said | did rows: the request on top, then the agent's words beside what the system did. Findings
// and review reasons both use it. A reason hides the Did lane when it names nothing the system did.
import type { Detection, Evidence } from "@/report/schema";
import { AskedLane, DidLane, SaidLane } from "./EvidenceLanes";

export function LaneRows({
  evidence,
  asked,
  said,
  did,
  detections,
  markClass,
  showEmptyDid,
}: {
  evidence: Evidence;
  asked: number[];
  said: number[];
  did: number[];
  detections: Detection[];
  markClass: string;
  showEmptyDid: boolean;
}) {
  // The Said lane draws only agent turns, so the two-column layout waits for one.
  const hasSaid = said.some((seq) => evidence.items.some((it) => it.seq === seq && it.kind === "turn" && it.role === "agent"));
  return (
    <>
      {asked.length > 0 ? (
        <div className="mt-4">
          <AskedLane evidence={evidence} seqs={asked} />
        </div>
      ) : null}
      <div className={`mt-4 grid gap-6 ${hasSaid ? "md:grid-cols-2 md:gap-0 md:[&>*:first-child]:pr-8 md:[&>*:last-child]:border-l md:[&>*:last-child]:border-report-line md:[&>*:last-child]:pl-8" : ""}`}>
        {hasSaid ? <SaidLane evidence={evidence} seqs={said} detections={detections} markClass={markClass} /> : null}
        <DidLane evidence={evidence} seqs={did} hideWhenEmpty={!showEmptyDid} />
      </div>
    </>
  );
}
