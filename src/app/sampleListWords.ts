// Every word the hosted sample list says that is not a verdict or a result label (those come from
// src/report/labels.ts). Real apostrophes, no dashes.

/** Where "Run it on your calls" goes: the README section that says how to run Overhear on your own calls. One line to change. */
export const RUN_IT_URL = "https://github.com/DevanshuNEU/overhear#run-overhear-on-your-machine";

export const SAMPLE_WORDS = {
  // The headline: the count, then what it means.
  failedHeadline: (failed: number, total: number) => `${failed} of ${total} sample ${total === 1 ? "call" : "calls"} failed.`,
  headlineNext: "Each one is checked against what the agent told the caller. No AI model decides the verdict.",
  listLabel: "Sample calls",

  // The shell's right side.
  navNote: "Sample calls from our demo agent.",
  runIt: "Run it on your calls",

  // Under a filter with no matches, then the way out.
  noMatches: {
    failed: "No failed sample calls.",
    needs_review: "No sample calls that need review.",
    passed: "No passed sample calls.",
    nothing_done: "No sample calls with nothing done.",
  },
  showAll: "Show all sample calls",

  // Under the list.
  footer: "Overhear runs on your computer with your own Retell key. Your calls never leave it.",
} as const;
