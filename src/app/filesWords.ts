// Every word the files screens say: the LiveKit part of the connect screen and the list of calls read from files.
// Verdict and result words come from src/report/labels.ts, the refusals and reasons from src/files/labels.ts. Real
// apostrophes, no dashes, no exclamation marks.
import { MAX_CALLS } from "@/files/labels";

export const FILES_WORDS = {
  // The connect screen.
  lead: "On LiveKit Agents?",
  body: "Open the session reports your agent saves, one JSON file per call. They stay on this computer.",
  open: "Open session reports",
  opening: "Opening",
  dropLabel: "Drop session reports here",
  dropHint: "Or drop the files here.",
  howTo: "How to save them",
  howToLead: "In your agent, save the report when each session ends:",
  howToRegister: "Pass the function as on_session_end when you register the session:",
  howToCode: `async def on_session_end(ctx):
    report = ctx.make_session_report()
    Path("reports").mkdir(exist_ok=True)
    Path(f"reports/{report.job_id}.json").write_text(json.dumps(report.to_dict()))`,
  howToRegisterCode: "@server.rtc_session(on_session_end=on_session_end)",
  noneRead: "Overhear couldn’t use any of those files.",
  serverDown: "Couldn’t reach Overhear on this computer. Check that it is still running, then try again.",

  // The list.
  listLabel: "Your calls",
  headline: (failed: number, total: number) => `${failed} of ${total} ${total === 1 ? "call" : "calls"} failed.`,
  headlineNext: (files: number) => `Read from ${files} session report ${files === 1 ? "file" : "files"} on this computer.`,
  noCallsHeadline: "No calls could be read.",
  noCallsNext: "The files that were set aside are listed below.",
  navNote: "Reading files on this computer.",
  openMore: "Open more reports",
  clear: "Clear",
  clearing: "Clearing",
  clearFailed: "Couldn’t clear the files. Try again.",
  problemsHeading: "Files that were set aside",
  problem: (file: string, reason: string) => `${file}: ${reason}`,
  noMatches: {
    failed: (n: number) => `No failed calls in these ${n}.`,
    needs_review: (n: number) => `No calls that need review in these ${n}.`,
    passed: (n: number) => `No passed calls in these ${n}.`,
    nothing_done: (n: number) => `No calls with nothing done in these ${n}.`,
  },
  full: `Overhear holds ${MAX_CALLS} calls at most.`,
} as const;
