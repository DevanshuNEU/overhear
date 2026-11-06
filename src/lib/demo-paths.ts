// Where the clinic demo lives. The demo dashboard moved from `/` to `/demo`, and its call pages from `/calls/{id}`
// to `/demo/calls/{id}`, so `/` is free for the product. Pure and dependency-free, so `src/proxy.ts` can use it.

export const DEMO_HOME = "/demo";

/** The demo page for one call. */
export function demoCallHref(id: string): string {
  return `${DEMO_HOME}/calls/${encodeURIComponent(id)}`;
}

// A link shared before the move: `/calls/{id}`, with or without a trailing slash. The id stays as it came, already
// encoded in the path.
const OLD_CALL_PATH = /^\/calls\/([^/]+)\/?$/;

/** The new path for an old demo link, or null when the path did not move. */
export function movedDemoPath(pathname: string): string | null {
  const match = OLD_CALL_PATH.exec(pathname);
  return match ? `${DEMO_HOME}/calls/${match[1]}` : null;
}
