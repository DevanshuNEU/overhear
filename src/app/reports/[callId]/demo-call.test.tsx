import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import caseJson from "../../../../eval/engine/cases/mut-transfer-claim-caller-kept-asking-then-left.json";

const jar = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (name === "overhear_demo_calls" && jar.value ? { name, value: jar.value } : undefined) }) }));
vi.mock("@/lib/env", () => ({ env: { RETELL_API_KEY: "key_test_secret", RETELL_AGENT_ID: "agent_demo" } }));

import ReportPage from "./page";
import { signDemoCookie } from "@/demo-call/cookie";
import { demoCallResult, resetDemoCalls } from "@/demo-call/store";

const ID = "call_my_demo_call";
const params = (callId: string) => ({ params: Promise.resolve({ callId }) });

beforeEach(async () => {
  vi.stubEnv("OVERHEAR_LOCAL", "");
  resetDemoCalls();
  jar.value = undefined;
  // The server has checked the call, so its report is in memory.
  await demoCallResult(ID, { getCall: async () => ({ ...caseJson.record, call_id: ID, agent_id: "agent_demo" }) });
});
afterEach(() => vi.unstubAllEnvs());

describe("/reports/{callId} for a call made on the demo", () => {
  it("renders the report when the cookie vouches for the call and the server has it", async () => {
    jar.value = signDemoCookie([ID], "key_test_secret");
    render(await ReportPage(params(ID)));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/transferring/i);
  });

  it("is a 404 with no cookie", async () => {
    await expect(ReportPage(params(ID))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("is a 404 when the cookie is for another call, or signed with another key", async () => {
    jar.value = signDemoCookie(["call_someone_else"], "key_test_secret");
    await expect(ReportPage(params(ID))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    jar.value = signDemoCookie([ID], "another_key");
    await expect(ReportPage(params(ID))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("is a 404 when the server no longer has the call", async () => {
    jar.value = signDemoCookie([ID], "key_test_secret");
    resetDemoCalls();
    await expect(ReportPage(params(ID))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("is a 404 in local mode, cookie or not", async () => {
    vi.stubEnv("OVERHEAR_LOCAL", "1");
    jar.value = signDemoCookie([ID], "key_test_secret");
    await expect(ReportPage(params(ID))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });
});
