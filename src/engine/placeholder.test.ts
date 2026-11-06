// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isPlaceholder } from "./placeholder";

describe("isPlaceholder", () => {
  // Retell's docs show "[email 1]" and "[person name 2]"; other categories and the underscored form are not
  // documented, so the match is lenient. A false match makes a value unresolved, which is the safe side.
  it.each(["[person name 1]", "[email 1]", "[date_of_birth_1]", "[PII INFO]", "[NAME_GIVEN]", "Dr. [person name 2]"])(
    "accepts %j",
    (value) => {
      expect(isPlaceholder(value)).toBe(true);
    },
  );

  it.each(["Dr. Nair", "[]", "[1]", "", "2026-11-02T14:00:00Z", "a [ b ] c"])("rejects %j", (value) => {
    expect(isPlaceholder(value)).toBe(false);
  });

  it.each([null, undefined, 1, true, ["[email 1]"], { name: "[person name 1]" }])("rejects a value that is not a string: %j", (value) => {
    expect(isPlaceholder(value)).toBe(false);
  });
});
