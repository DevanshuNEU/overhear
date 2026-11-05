"use client";

// Copies the call id. The only thing on this screen that needs the browser.
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { COPIED_LABEL, COPY_ID_LABEL } from "@/report/labels";

export function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
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
        aria-label={COPY_ID_LABEL}
        className="inline-flex size-11 items-center justify-center rounded-md text-report-muted hover:bg-report-accent-tint hover:text-report-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-report-accent sm:size-8"
      >
        <Icon aria-hidden className="size-4" />
      </button>
      <span role="status" className="text-[13px] text-report-muted">
        {copied ? COPIED_LABEL : ""}
      </span>
    </span>
  );
}
