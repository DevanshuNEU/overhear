// Local mode: the product runs on the user's own machine (`OVERHEAR_LOCAL=1`). Without it the app is a hosted
// copy, such as the Railway demo, where `/` sends visitors to the demo at /demo.

export function isLocalMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.OVERHEAR_LOCAL === "1";
}
