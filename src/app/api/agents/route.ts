// GET lists the voice agents on the stored Retell key as { id, name }, sorted by name, for the test call screen. Nothing else
// of an agent leaves: no prompt, LLM id or webhook URL (see listAgents in src/pull/retell-source.ts). Local mode only: a
// hosted copy answers 404, and the loopback and Host checks run here as well as in src/proxy.ts. A read from another site
// or another port is refused (403) however it is made.
import { assertLocalRequest } from "@/pull/local";
import { listAgentChoices } from "@/pull/test-call";
import { failed, json } from "../test-calls/_shared";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const refused = assertLocalRequest(request);
  if (refused) return refused;
  try {
    const listed = await listAgentChoices();
    return listed.ok ? json({ agents: listed.agents }) : failed(listed.code);
  } catch {
    return failed("failed");
  }
}
