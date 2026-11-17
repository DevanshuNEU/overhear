// `/` belongs to the product. A hosted copy has no Retell key, so it shows the sample calls: real calls from the demo
// agent, checked by the engine on the server. In local mode (`OVERHEAR_LOCAL=1`) it is the connect screen: paste a
// Retell key, or, when one is saved, the list of the latest calls and what the engine found in each. Rendered per
// request (see `dynamic`), so `next build` cannot bake in either branch.
import { sampleRows } from "@/demo-samples";
import { displayConfigPath, hasKey, KeyStoreError } from "@/pull/key-store";
import { isLocalMode } from "@/pull/local";
import type { ConnectError } from "@/pull/labels";
import { logSafe, safeError } from "@/pull/redact";
import { HomeScreen } from "./HomeScreen";
import { SampleListScreen } from "./SampleListScreen";

export const dynamic = "force-dynamic";

/** Whether a key is saved, or the reason the key store would not open. */
async function savedKey(): Promise<{ stored: boolean; storeError?: ConnectError }> {
  try {
    return { stored: await hasKey() };
  } catch (err) {
    // The store refused to open: say why on screen, in its own words. Anything else is logged without detail.
    if (err instanceof KeyStoreError) return { stored: false, storeError: err.code };
    const safe = safeError(err);
    logSafe("connect.read_failed", safe.status === undefined ? { name: safe.name, code: safe.code } : { name: safe.name, status: safe.status, code: safe.code });
    return { stored: false, storeError: "store_failed" };
  }
}

export default async function Home() {
  if (!isLocalMode()) return <SampleListScreen rows={sampleRows()} />;

  const { stored, storeError } = await savedKey();
  return <HomeScreen stored={stored} location={displayConfigPath()} storeError={storeError} />;
}
