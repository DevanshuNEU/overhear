"use client";

// Copies the call id. The only thing on this screen that needs the browser.
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { COPIED_LABEL, COPY_ID_LABEL } from "@/report/labels";

/** `label` makes it a bordered button with words, for the next-steps column. Without it, an icon beside the call id. */
export function CopyId({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // No timer outlives the button.
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      // Each copy restarts the wait, so an earlier copy's timer cannot cut a later one short.
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked: the id is still on screen to select.
    }
  }

  const Icon = copied ? Check : Copy;
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        aria-label={label ? undefined : COPY_ID_LABEL}
        className={
          label
            ? "inline-flex min-h-11 items-center gap-2 rounded-md border border-report-line-strong px-3 text-sm hover:bg-report-accent-tint hover:text-report-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent sm:min-h-9"
            : "inline-flex size-11 items-center justify-center rounded-md text-report-muted hover:bg-report-accent-tint hover:text-report-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent sm:size-8"
        }
      >
        <Icon aria-hidden className="size-4" />
        {label}
      </button>
      <span role="status" className="text-[13px] text-report-muted">
        {copied ? COPIED_LABEL : ""}
      </span>
    </span>
  );
}
