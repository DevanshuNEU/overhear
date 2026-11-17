// A stand-in for next/navigation in component tests, which render without the App Router. The address lives here:
// router.push and router.replace change it and tell every reader, the way the real router would. Use it with
//   vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), ...(await import("@/test-utils/fakeNavigation")).navigationMock }));
import { useSyncExternalStore } from "react";
import { vi } from "vitest";

const listeners = new Set<() => void>();
let location = new URL("http://localhost/");
let routeParams: Record<string, string> = {};
let cached: { search: string; params: URLSearchParams } = { search: "", params: new URLSearchParams() };

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const move = (href: string) => {
  location = new URL(href, location);
  listeners.forEach((fn) => fn());
};

const searchParams = () => {
  if (cached.search !== location.search) cached = { search: location.search, params: new URLSearchParams(location.search) };
  return cached.params;
};

export const router = {
  push: vi.fn((href: string) => move(href)),
  replace: vi.fn((href: string) => move(href)),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

/** Where the fake router is now, as path plus query. */
export const currentHref = () => location.pathname + location.search;

/** Puts the fake router at an address, with the route's params (e.g. { callId }). Forgets earlier calls to push and replace. */
export function visit(href: string, params: Record<string, string> = {}) {
  location = new URL(href, "http://localhost");
  routeParams = params;
  for (const fn of Object.values(router)) fn.mockClear();
  listeners.forEach((fn) => fn());
}

export const navigationMock = {
  useRouter: () => router,
  useSearchParams: () => useSyncExternalStore(subscribe, searchParams, searchParams),
  usePathname: () => useSyncExternalStore(subscribe, () => location.pathname, () => location.pathname),
  useParams: () => routeParams,
};
