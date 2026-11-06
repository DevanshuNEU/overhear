import { describe, expect, it } from "vitest";
import { claimClass } from "@/report/schema";
import { CLAIM_CLASSES } from "./claims";

describe("CLAIM_CLASSES", () => {
  it("reads the schema's claimClass instead of keeping its own copy", () => {
    expect(CLAIM_CLASSES.promise_backed).toBe(claimClass.promise_backed);
    expect(CLAIM_CLASSES.spoken_matches_committed).toBe(claimClass.spoken_matches_committed);
  });

  it("adds tool_syntax to transfers, which the schema accepts as a transfer claim in its violated check", () => {
    expect(CLAIM_CLASSES.transfer_kept).toEqual([...claimClass.transfer_kept!, "tool_syntax"]);
  });
});
