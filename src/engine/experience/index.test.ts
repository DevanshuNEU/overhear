// @vitest-environment node
// The experience runner: checks run in EXPERIENCE_CHECKS order, a check not built yet or unable to run is left out
// of ran, and the report it fills validates.
import { describe, expect, it } from "vitest";
import { ev, type ItemSpec } from "../testing/build";
import { runExperience } from "./index";

const agent = (text: string): ItemSpec => ({ kind: "turn", role: "agent", text, startSec: null, interrupted: null });

describe("runExperience", () => {
  it("lists the checks that ran, in EXPERIENCE_CHECKS order, and leaves out checks not built", () => {
    expect(runExperience(ev([agent("Hello.")]))).toEqual({ ran: ["agent_ends_call"], problems: [] });
  });

  it("leaves out a check that could not run", () => {
    expect(runExperience(ev([]))).toEqual({ ran: [], problems: [] });
  });

  it("collects each check's problems under its id", () => {
    const out = runExperience(ev([agent("Goodbye!"), agent("Goodbye!")]));
    expect(out.ran).toEqual(["agent_ends_call"]);
    expect(out.problems.map((p) => p.check)).toEqual(["agent_ends_call"]);
  });
});
