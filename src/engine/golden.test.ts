// @vitest-environment node
// The goldens: the engine's report for each sample call equals the sample, under M1's scheduling pack
// (m1View in testing/build.ts). Task 10 turns these into tests once checkCall exists.
import { describe, it } from "vitest";

describe("goldens", () => {
  it.todo("failed sample: engine output equals m1View");
  it.todo("passed sample: engine output equals m1View");
  // M1 has no request source, so it cannot reproduce the needs-review verdict, which rests on a request a model found.
  it.todo("needs-review sample: M1 pins passed with request_not_checked (M2 owns the full golden)");
});
