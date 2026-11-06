// @vitest-environment node
// The lock: a locked case's verdict is a promise. When the engine's verdict for a locked case differs from the
// case's expected verdict, CI fails. To change a locked verdict on purpose, edit the case file in the same pull
// request and say why in label.note.
//
// Until Task 10 wires the real engine, the eval runs a stand-in that has no verdicts, so each lock is a todo with
// that reason rather than a test that fails for everyone or passes for nothing. Swapping the engine in
// src/engine/eval/engine.ts turns them on.
import { describe, expect, it } from "vitest";
import { loadCases } from "../../../scripts/engine-evals/io";
import { engine, isStandIn } from "./engine";
import { brokenLock, runCase } from "./run";

const locked = loadCases().filter((c) => c.locked);
const standIn = isStandIn(engine);

describe("locked cases keep their verdict", () => {
  it("there are locked cases to hold", () => {
    expect(locked.length).toBeGreaterThan(0);
  });

  for (const c of locked) {
    const name = `${c.id}: the engine's verdict is ${c.expect.verdict}`;
    if (standIn) {
      it.todo(`${name} (waits for the real engine: Task 10 swaps the stand-in in src/engine/eval/engine.ts)`);
    } else {
      it(name, () => {
        expect(brokenLock(runCase(c, engine))).toBeNull();
      });
    }
  }
});
