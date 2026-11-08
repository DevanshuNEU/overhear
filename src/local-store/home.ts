// The folder Overhear keeps its files in: the pasted key (src/pull/key-store.ts) and pinned calls (src/pinned/store.ts).
import os from "node:os";
import path from "node:path";

/** The directory that holds them: OVERHEAR_HOME when it is an absolute path, else ~/.overhear. */
export function overhearHome(env: Record<string, string | undefined> = process.env): string {
  const override = env.OVERHEAR_HOME;
  if (override && path.isAbsolute(override)) return override;
  return path.join(os.homedir(), ".overhear");
}
