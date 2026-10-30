// Rescores every call that was recorded but never scored, for example because
// the server restarted while scoring ran after the webhook was acknowledged.
// Fetches each call from Retell's API and runs the normal pipeline. Run by
// hand: `npm run rescore`. Needs DATABASE_URL, RETELL_API_KEY and the judge keys.
import Retell from "retell-sdk";
import { db } from "@/db/client";
import { env } from "@/lib/env";
import { scoreCall, type RetellCall } from "@/qa/pipeline";
import { listUnscoredCallIds } from "@/qa/queries";

async function main() {
  const client = new Retell({ apiKey: env.RETELL_API_KEY });
  const ids = await listUnscoredCallIds(db);
  console.log(`${ids.length} unscored call${ids.length === 1 ? "" : "s"}`);
  let failed = 0;
  for (const id of ids) {
    try {
      const call = (await client.call.retrieve(id)) as unknown as RetellCall;
      const score = await scoreCall(call);
      console.log(`scored ${id}: ${score.composite}`);
    } catch (err) {
      failed++;
      console.error(`could not score ${id}`, err);
    }
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
