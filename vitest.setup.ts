import "@testing-library/jest-dom/vitest";

// jsdom has no ResizeObserver, which recharts (via shadcn ChartContainer's
// ResponsiveContainer) needs. A no-op polyfill lets chart components render in
// tests without throwing.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
