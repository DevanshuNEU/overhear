// agent_ends_call: does the agent end the call when the conversation is over? Two problems it finds: a goodbye loop
// (the agent keeps saying goodbye to a caller who has already said it, three or more times) and a line left open (the agent said goodbye,
// then the call sat silent until it timed out). Precision over recall: a closing is judged only at the very end of
// the call, so an early "have a great day" that the call moves on from is never a problem.
import type { Evidence, ExperienceProblem } from "@/report/schema";
import { goodbyeLoopText, lineLeftOpenText } from "../wording";
import type { ExperienceCheck } from "./common";

/** The phrases that make an agent turn a goodbye, matched case-insensitively on word boundaries. */
export const CLOSING_PHRASES = ["goodbye", "good bye", "bye", "bye-bye", "have a great day", "have a good day", "have a nice day", "have a great evening", "have a good one", "take care"] as const;

/**
 * How many agent turns a closing run needs to be a loop. Two goodbyes ("Have a great day!" / "You too. Bye." /
 * "Goodbye!") is how people normally end a call, so only a third means the agent is not ending it.
 */
export const GOODBYE_LOOP_MIN_TURNS = 3;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Longest first so "bye-bye" is read whole. A letter, digit or underscore on either side means the phrase sits
// inside another word, which is no closing. "take care of" is a promise to handle something, not a farewell.
const CLOSING = new RegExp(`(?<![\\w])(?:${[...CLOSING_PHRASES].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\w])`, "i");
const TAKE_CARE_OF = /\btake care of\b/gi;

/** Whether an agent's words are a goodbye. */
export function isGoodbye(text: string): boolean {
  return CLOSING.test(text.replace(TAKE_CARE_OF, " "));
}

interface AgentTurn {
  seq: number;
  goodbye: boolean;
}

export const agentEndsCall: ExperienceCheck = (ev: Evidence) => {
  const turns: AgentTurn[] = ev.items.flatMap((it) => (it.kind === "turn" && it.role === "agent" ? [{ seq: it.seq, goodbye: isGoodbye(it.text) }] : []));
  if (turns.length === 0) return { ran: false, problems: [] };

  // The closing run: the agent's last turns while each is a goodbye. Caller turns and non-turn items between them
  // are skipped, so closing / "Goodbye!" / closing / "Bye." / closing is one run of three.
  const run: AgentTurn[] = [];
  for (let i = turns.length - 1; i >= 0 && turns[i].goodbye; i--) run.unshift(turns[i]);

  const problems: ExperienceProblem[] = [];
  if (run.length >= GOODBYE_LOOP_MIN_TURNS) problems.push({ check: "agent_ends_call", text: goodbyeLoopText(run.map((t) => t.seq), ev), seqs: run.map((t) => t.seq) });
  const last = turns[turns.length - 1];
  if (last.goodbye && ev.callFields.disconnection_reason === "inactivity") problems.push({ check: "agent_ends_call", text: lineLeftOpenText(last.seq, ev), seqs: [last.seq] });
  return { ran: true, problems };
};
