"use client";

// The LiveKit part of the connect screen: LiveKit has no account we read, so a team brings its own files, one session
// report per call. A button opens the file picker, and the same area takes files dropped on it. The files are read in
// the browser and sent to this computer's server only (src/app/filesClient.ts). When at least one call was read the
// screen hands over (onOpened); when none could be, the files that were set aside are listed right here.
import { useRef, useState, type DragEvent } from "react";
import { CircleAlert, Loader2 } from "lucide-react";
import { PROBLEM_REASON, type FileProblem } from "@/files/labels";
import { BUTTON } from "./callClient";
import { openReportFiles } from "./filesClient";
import { FILES_WORDS } from "./filesWords";

type Phase = { kind: "ready" } | { kind: "opening" } | { kind: "failed"; message: string; problems: FileProblem[] };

type Props = {
  /** At least one call was read from the files. */
  onOpened: () => void;
};

export function LiveKitFiles({ onOpened }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });
  const [over, setOver] = useState(false);
  const opening = phase.kind === "opening";

  async function open(list: FileList | File[] | null) {
    const files = list === null ? [] : Array.from(list);
    if (files.length === 0 || opening) return;
    setPhase({ kind: "opening" });
    const result = await openReportFiles(files);
    if (!result.ok) return setPhase({ kind: "failed", message: result.message, problems: [] });
    if (result.rows.length > 0) return onOpened();
    setPhase({ kind: "failed", message: FILES_WORDS.noneRead, problems: result.problems });
  }

  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setOver(false);
    void open(event.dataTransfer.files);
  }

  const failed = phase.kind === "failed" ? phase : null;

  return (
    <section
      aria-labelledby="livekit-lead"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={drop}
      data-dragging={over ? "" : undefined}
      className={`mt-12 border-t border-report-line pt-8 data-[dragging]:rounded-md data-[dragging]:outline-2 data-[dragging]:outline-dashed data-[dragging]:outline-offset-8 data-[dragging]:outline-report-accent`}
    >
      <h2 id="livekit-lead" className="text-sm font-semibold">
        {FILES_WORDS.lead}
      </h2>
      <p className="mt-1 max-w-[560px] text-sm text-report-muted">{FILES_WORDS.body}</p>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          multiple
          hidden
          tabIndex={-1}
          aria-label={FILES_WORDS.dropLabel}
          onChange={(e) => {
            void open(e.currentTarget.files);
            e.currentTarget.value = "";
          }}
        />
        <button type="button" disabled={opening} onClick={() => input.current?.click()} className={BUTTON}>
          {opening ? (
            <>
              <span aria-hidden className="report-delayed inline-flex">
                <Loader2 className="size-4 motion-safe:animate-spin" />
              </span>
              {FILES_WORDS.opening}
            </>
          ) : (
            FILES_WORDS.open
          )}
        </button>
        <span className="text-[13px] text-report-muted">{FILES_WORDS.dropHint}</span>
      </div>

      <div aria-live="polite" className="empty:hidden">
        {failed ? (
          <div className="mt-3 text-sm text-report-critical">
            <p className="flex gap-2">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              <strong className="font-semibold">{failed.message}</strong>
            </p>
            {failed.problems.length > 0 ? (
              <ul className="mt-2 space-y-1 pl-6 text-report-ink-2">
                {failed.problems.map((p) => (
                  <li key={p.file} className="break-all">
                    {FILES_WORDS.problem(p.file, PROBLEM_REASON[p.reason])}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <details className="group mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md text-[13px] text-report-muted underline underline-offset-2 hover:text-report-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent [&::-webkit-details-marker]:hidden">
          {FILES_WORDS.howTo}
        </summary>
        <div className="max-w-[640px] pb-2 text-[13px] text-report-ink-2">
          <p>{FILES_WORDS.howToLead}</p>
          <pre className="mt-2 overflow-x-auto rounded-md border border-report-line bg-report-surface p-3 font-mono text-[13px] leading-5">
            <code>{FILES_WORDS.howToCode}</code>
          </pre>
          <p className="mt-3">{FILES_WORDS.howToRegister}</p>
          <pre className="mt-2 overflow-x-auto rounded-md border border-report-line bg-report-surface p-3 font-mono text-[13px] leading-5">
            <code>{FILES_WORDS.howToRegisterCode}</code>
          </pre>
        </div>
      </details>
    </section>
  );
}
