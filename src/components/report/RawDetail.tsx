// A raw payload, closed until someone asks for it.
import { RAW_DETAIL_LABEL } from "@/report/labels";
import { rawText } from "./format";

export function RawDetail({ raw }: { raw: unknown }) {
  if (raw === undefined || raw === null) return null;
  return (
    <details data-raw className="mt-1">
      <summary className="inline-block cursor-pointer rounded py-0.5 text-[13px] text-report-muted hover:text-report-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent">
        {RAW_DETAIL_LABEL}
      </summary>
      <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-report-line bg-report-canvas p-3 font-mono text-[12px] leading-relaxed text-report-ink-2">
        {rawText(raw)}
      </pre>
    </details>
  );
}
