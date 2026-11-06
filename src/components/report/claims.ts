// The speech classes each contract's claim is made of, so the words marked are the words the verdict rests on.
// The schema's own mapping (claimClass in schema.ts), plus tool_syntax for transfers, which the schema accepts
// as a transfer claim in its violated check.
import { claimClass, type ContractId, type Detection, type SpeechClass } from "@/report/schema";

export const CLAIM_CLASSES: Readonly<Partial<Record<ContractId, readonly SpeechClass[]>>> = {
  ...claimClass,
  transfer_kept: [...(claimClass.transfer_kept ?? []), "tool_syntax"],
};

/** The detections that are the claim a contract rests on. */
export function claimsFor(contract: ContractId, detections: Detection[]): Detection[] {
  const classes = CLAIM_CLASSES[contract] ?? [];
  return detections.filter((d) => classes.includes(d.cls));
}

/**
 * The claim words to mark for one finding. Several claims can share a turn, and a finding is about one of them.
 * Where the finding's own sentence quotes a claim, only the quotes it holds are marked. Where it quotes none,
 * a turn with a single claim of this kind has that one marked, and a turn with several is left unmarked, since
 * marking all of them would colour words the finding is not about.
 */
export function citedClaims(finding: { text: string }, contract: ContractId, detections: Detection[]): Detection[] {
  const bySeq = new Map<number, Detection[]>();
  for (const d of claimsFor(contract, detections)) bySeq.set(d.seq, [...(bySeq.get(d.seq) ?? []), d]);
  return [...bySeq.values()].flatMap((atTurn) => {
    const quoted = atTurn.filter((d) => finding.text.includes(d.quote));
    if (quoted.length > 0) return quoted;
    return atTurn.length === 1 ? atTurn : [];
  });
}
