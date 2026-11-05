import { describe, it, expect } from "vitest";
import { inFlightToolCallId } from "./tool-call-id";

const inv = (id: string, name: string) => ({ role: "tool_call_invocation", tool_call_id: id, name, arguments: "{}" });
const res = (id: string) => ({ role: "tool_call_result", tool_call_id: id, content: "{}" });

describe("inFlightToolCallId", () => {
  it("returns the id of the last invocation whose name matches and has no result", () => {
    const body = {
      name: "book_appointment",
      call: {
        transcript_with_tool_calls: [
          inv("a1", "verify_patient"), res("a1"),
          { role: "agent", content: "One sec." }, inv("b2", "book_appointment"),
        ],
      },
    };
    expect(inFlightToolCallId(body)).toBe("b2");
  });

  it("returns null when that invocation already has a result", () => {
    const body = {
      name: "book_appointment",
      call: { transcript_with_tool_calls: [inv("b2", "book_appointment"), res("b2")] },
    };
    expect(inFlightToolCallId(body)).toBeNull();
  });

  it("returns null for an args-only payload", () => {
    expect(inFlightToolCallId({ name: "x" })).toBeNull();
  });

  it("skips an earlier answered call to the same tool and picks the open one", () => {
    const body = {
      name: "check_availability",
      call: { transcript_with_tool_calls: [inv("c1", "check_availability"), res("c1"), inv("c2", "check_availability")] },
    };
    expect(inFlightToolCallId(body)).toBe("c2");
  });

  it("returns null when no invocation matches the tool name", () => {
    const body = { name: "book_appointment", call: { transcript_with_tool_calls: [inv("a1", "verify_patient")] } };
    expect(inFlightToolCallId(body)).toBeNull();
  });

  it("ignores malformed items without throwing", () => {
    const body = {
      name: "book_appointment",
      call: { transcript_with_tool_calls: [null, "x", 3, { role: "tool_call_invocation" }, inv("b2", "book_appointment")] },
    };
    expect(inFlightToolCallId(body)).toBe("b2");
  });
});
