// Manual, one-off provisioning script — run by hand with a real
// RETELL_API_KEY (`npm run provision:agent`), never imported by the app, so
// it has no effect on `next build`. Prints the new agent_id; persist it into
// .env as RETELL_AGENT_ID for the /api/web-call route to use.
import Retell from "retell-sdk";
import { env } from "@/lib/env";
import { buildLlmConfig, buildAgentConfig } from "@/retell/agent-config";

const client = new Retell({ apiKey: env.RETELL_API_KEY });
const llm = await client.llm.create(buildLlmConfig(env.APP_URL) as never);
const agent = await client.agent.create(buildAgentConfig(llm.llm_id) as never);
console.log("AGENT_ID:", agent.agent_id);
