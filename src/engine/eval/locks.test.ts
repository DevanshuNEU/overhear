// @vitest-environment node
// The lock: a locked case's verdict is a promise. When the engine's verdict for a locked case differs from the
// case's expected verdict, CI fails. To change a locked verdict on purpose, edit the case file in the same pull
// request and say why in label.note.
import { describe, expect, it } from "vitest";
import { loadCases } from "../../../scripts/engine-evals/io";
import { engine } from "./engine";
import { brokenLock, runCase } from "./run";

const locked = loadCases().filter((c) => c.locked);

describe("locked cases keep their verdict", () => {
  it("there are locked cases to hold", () => {
    expect(locked.length).toBeGreaterThan(0);
  });

  for (const c of locked) {
    it(`${c.id}: the engine's verdict is ${c.expect.verdict}`, () => {
      expect(brokenLock(runCase(c, engine))).toBeNull();
    });
  }
});
