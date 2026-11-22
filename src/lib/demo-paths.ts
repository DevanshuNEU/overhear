// The pages of the first version of the product: the demo dashboard at `/demo`, its call pages at `/demo/calls/{id}`
// and, before that, `/calls/{id}`. They are gone. A link shared earlier now goes to the home page. Pure and
// dependency-free, so `src/proxy.ts` can use it.

const OLD_PATH = /^\/(?:calls\/[^/]+|demo(?:\/calls\/[^/]+)?)\/?$/;

/** Where an old demo link goes ("/"), or null when the path is not one of them. */
export function movedDemoPath(pathname: string): string | null {
  return OLD_PATH.test(pathname) ? "/" : null;
}
