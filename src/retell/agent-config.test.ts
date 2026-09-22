import { describe, it, expect, vi } from "vitest";

describe("buildLlmConfig", () => {
  it("declares all five tools pointing at the app url", async () => {
    const { buildLlmConfig } = await import("./agent-config");
    const cfg = buildLlmConfig("https://app.example");
    const names = cfg.general_tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "book_appointment", "cancel_appointment", "check_availability",
      "reschedule_appointment", "verify_patient",
    ]);
    expect(cfg.general_tools.every((t) => t.url.startsWith("https://app.example/api/tools/"))).toBe(true);
  });

  it("system prompt forbids medical advice and requires verification before booking", async () => {
    const { buildLlmConfig } = await import("./agent-config");
    const cfg = buildLlmConfig("https://app.example");
    expect(cfg.general_prompt).toMatch(/verify/i);
    expect(cfg.general_prompt).toMatch(/medical advice/i);
  });

  it("each tool's parameters match its clinic-service method args", async () => {
    const { buildLlmConfig } = await import("./agent-config");
    const cfg = buildLlmConfig("https://app.example");
    const byName = Object.fromEntries(cfg.general_tools.map((t) => [t.name, t]));

    expect(byName.check_availability.url).toBe("https://app.example/api/tools/check-availability");
    expect(byName.check_availability.parameters.required ?? []).toEqual([]);
    expect(Object.keys(byName.check_availability.parameters.properties).sort()).toEqual(["date", "providerName"]);

    expect(byName.verify_patient.url).toBe("https://app.example/api/tools/verify-patient");
    expect(byName.verify_patient.parameters.required?.sort()).toEqual(["dob", "name"]);

    expect(byName.book_appointment.url).toBe("https://app.example/api/tools/book-appointment");
    expect(byName.book_appointment.parameters.required?.sort()).toEqual(["patientId", "slotId"]);

    expect(byName.reschedule_appointment.url).toBe("https://app.example/api/tools/reschedule-appointment");
    expect(byName.reschedule_appointment.parameters.required?.sort()).toEqual(["appointmentId", "newSlotId"]);

    expect(byName.cancel_appointment.url).toBe("https://app.example/api/tools/cancel-appointment");
    expect(byName.cancel_appointment.parameters.required).toEqual(["appointmentId"]);
  });

  it("every tool is a custom POST tool that speaks during execution", async () => {
    const { buildLlmConfig } = await import("./agent-config");
    const cfg = buildLlmConfig("https://app.example");
    for (const tool of cfg.general_tools) {
      expect(tool.type).toBe("custom");
      expect(tool.method).toBe("POST");
      expect(tool.speak_during_execution).toBe(true);
    }
  });

  it("prompt also requires offering only slots returned by check_availability", async () => {
    const { buildLlmConfig } = await import("./agent-config");
    const cfg = buildLlmConfig("https://app.example");
    expect(cfg.general_prompt).toMatch(/check_availability/i);
  });
});

describe("buildAgentConfig", () => {
  it("points the response engine at the given llm id, sets a voice, and derives webhook_url from env.APP_URL", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", () => ({ env: { APP_URL: "https://app.example" } }));
    const { buildAgentConfig } = await import("./agent-config");

    const cfg = buildAgentConfig("llm_123");
    expect(cfg.response_engine).toEqual({ type: "retell-llm", llm_id: "llm_123" });
    expect(typeof cfg.voice_id).toBe("string");
    expect(cfg.voice_id.length).toBeGreaterThan(0);
    expect(cfg.webhook_url).toBe("https://app.example/api/webhooks/retell");

    vi.doUnmock("@/lib/env");
    vi.resetModules();
  });
});
