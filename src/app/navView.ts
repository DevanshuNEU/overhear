// Which calls the local shell links to, worked out on the server: just the Retell key (the default), just session report
// files, or both. The key store is read only when files are open, so a person who never opens a file changes nothing.
import { hasFiles } from "@/files/store";
import { hasKey } from "@/pull/key-store";
import type { NavView } from "./ProductNav";

export async function navView(): Promise<NavView> {
  if (!hasFiles()) return "retell";
  try {
    return (await hasKey()) ? "both" : "files";
  } catch {
    // A key store that will not open is explained on `/`: until then there is no key to link to.
    return "files";
  }
}
