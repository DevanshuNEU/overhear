import { Retell } from "retell-sdk";
import { env } from "@/lib/env";

// Shared Retell API client, configured from env. Not exercised by Task 5's
// tool routes (those only need signature verification) — this exists for
// forthcoming callers (e.g. agent provisioning, web-call token minting) that
// need to talk to the Retell API rather than just verify its webhooks.
export const retell = new Retell({ apiKey: env.RETELL_API_KEY });
