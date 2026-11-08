// Every word the call list says that is not a verdict or result label. Those come from src/report/labels.ts
// (VERDICT_LABEL, RESULT_LABEL) and are never written again here. Real apostrophes, no dashes.

const calls = (n: number) => `${n} ${n === 1 ? "call" : "calls"}`;

export const LIST_WORDS = {
  // The headline, by what the pull is doing.
  finding: (n: number) => `Finding your last ${n} calls.`,
  findingNext: "Retell is sending the list.",
  checked: (done: number, listed: number) => `Checked ${done} of ${listed} calls.`,
  checkedNext: "A failed call moves to the top as soon as it is found.",
  stopped: (done: number, listed: number) => `Stopped after ${done} of ${listed} calls.`,
  stoppedNext: "The calls already checked are below.",
  failedHeadline: (failed: number, total: number) => `${failed} of ${total} ${total === 1 ? "call" : "calls"} failed.`,
  doneNext: "Each one is checked against what the agent told the caller.",
  noCalls: "No calls yet in this Retell account.",
  noCallsNext: "Calls appear here once your agent has taken one.",
  noFinished: "No finished calls yet.",
  noFinishedNext: "Your newest calls haven’t ended. Check again when they have.",
  couldntList: "Couldn’t list your calls.",
  couldntFinish: "Couldn’t finish checking your calls.",
  couldntStart: "Couldn’t start checking your calls.",
  couldntStartNext: "Overhear didn’t answer on this computer. Check that it is still running, then try again.",

  // The pause when Retell asks for fewer requests.
  slowDown: (seconds: number) => `Retell asked us to slow down. Continuing in ${seconds} s.`,

  // The summary line: the total, then one count per verdict.
  total: calls,
  summaryLabel: "Verdict counts",
  couldntLoad: "Couldn’t load",

  // What a row says in place of a verdict.
  noTranscript: "Retell kept no transcript for this call.",
  couldntCheck: "Overhear couldn’t check this call.",
  stillCouldnt: "It failed again.",
  unknownLength: "Length unknown",
  checking: "Checking",

  // Controls.
  stop: "Stop checking",
  stopping: "Stopping",
  checkAgain: "Check again",
  testCall: "Test call",
  tryAgain: "Try again",
  retry: "Retry",
  retrying: "Retrying",
  choiceLabel: "Check the last",
  progressLabel: "Calls checked",

  // The list.
  listLabel: "Your calls",
  attentionHeading: "Look at these first",
  restHeading: "Everything else",
  skipped: (n: number) => `${n} ${n === 1 ? "call that hasn’t ended was" : "calls that haven’t ended were"} left out.`,

  // The connection bar.
  connected: "Connected to Retell.",
  keySavedIn: "Your key is saved in",
  disconnect: "Disconnect",
  disconnecting: "Disconnecting",
  disconnectFailed: "Couldn’t remove the key from this computer. Try again.",
} as const;
