"use client";

// The one piece of the call timeline that needs the browser: whether spoken numbers show as digits or as the
// exact words. The turns are drawn on the server with both forms in them, and this sets data-numbers on the box
// around them; the page's style (globals.css) shows one form or the other. Its heading row holds the switch,
// which is there only when the call has a number that was changed.
import { useState, type ReactNode } from "react";
import { NUMBERS_SWITCH } from "@/report/labels";

export function NumbersScope({ heading, hasNumbers, children }: { heading: ReactNode; hasNumbers: boolean; children: ReactNode }) {
  const [digits, setDigits] = useState(true);
  return (
    <div data-numbers={digits ? "digits" : "exact"}>
      <div className="mb-2 flex items-center justify-between gap-4">
        {heading}
        {hasNumbers ? (
          <button
            type="button"
            onClick={() => setDigits((d) => !d)}
            className="inline-flex min-h-11 items-center rounded-md px-2 text-[13px] text-report-muted hover:text-report-accent focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-report-accent sm:min-h-8"
          >
            {digits ? NUMBERS_SWITCH.toExact : NUMBERS_SWITCH.toDigits}
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
