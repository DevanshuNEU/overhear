# Overhear — Voice QA Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Retell voice agent for clinic scheduling plus an AI QA analyst that scores every call against ground truth, shown in a public dashboard where a visitor can talk to the agent and watch their call get graded live.

**Architecture:** One all-TypeScript Next.js (App Router) app. Tool endpoints back a Postgres clinic DB and log every agent action as a structured event. Retell's `call_analyzed` webhook feeds a QA pipeline: a deterministic reconciler scores the logic-checkable dimensions against the action log + DB, a Jev-first judge (Claude fallback) scores the transcript-reading dimensions, and the composite lands in the dashboard.

**Tech Stack:** Next.js 15 + TypeScript, Tailwind, Drizzle ORM, Postgres (postgres-js in prod, PGlite in tests), Retell SDK (`retell-sdk` server / `retell-client-js-sdk` browser), Vercel AI SDK 7 (`experimental_evaluate`) for Jev, Anthropic SDK for the Claude fallback + prose, Vitest + React Testing Library, Zod for env. Hosted on Railway.

**Spec:** `docs/superpowers/specs/2026-09-22-overhear-voice-qa-copilot-design.md`

## Global Constraints

- **Node** ≥ 20; **Next.js** ≥ 15 (App Router, route handlers).
- **Vercel AI SDK** ≥ 7.0.105 (required for `experimental_evaluate` / Jev). Jev model id: `typesafe-ai/jev`.
- **Retell webhook auth:** verify with `Retell.verify(rawBody, RETELL_API_KEY, signature)` using the **raw request body string** — never re-stringified JSON. Header: `x-retell-signature`.
- **Webhook events:** only `call_analyzed` carries `call_analysis`; `call_ended` must be ignored by the QA pipeline.
- **Tool endpoint responses:** ≤ 15,000 characters; any 2xx with string or JSON body.
- **Judge:** Jev-first, Claude fallback, both behind one `Judge` interface selected by `JUDGE_PROVIDER` env. The demo must never hard-depend on Jev being reachable.
- **PII:** all seeded patient data is synthetic. No real PII anywhere.
- **Dashboard:** public, read-only, no auth.
- **Model ids / exact `call_analyzed` nesting:** confirm against a live payload before hardcoding (flagged in `docs/research/retell-api-facts.md`).

### Git & commit conventions (applies to every task)

- **`master` is the single source of truth.** Never commit to `master` directly and never merge into it except through a reviewed, CI-green PR.
- **All work happens on feature branches** cut from `master` (neutral, intent-hiding names, e.g. `feat/overhear-...`). A unit of work = a branch = a PR.
- **Merge flow (every time):** branch from `master` → work with TDD commits → push → open PR (`gh pr create --base master`) → review the PR → let tests / CI run → merge **only** when everything passes. Then delete the merged branch and cut the next branch from the updated `master`.
- **Commit authorship:** commits are authored by **Devanshu Chicholikar** (the configured git user). **Do not add any `Co-Authored-By` trailer.**
- **Conventional Commits:** `type(scope): summary` — types: `feat`, `fix`, `test`, `refactor`, `chore`, `docs`, `build`, `ci`. Commit after each green TDD cycle (one logical change per commit).
- **CI gate:** a GitHub Actions workflow (`.github/workflows/ci.yml`, added in Task 1) runs install + lint + test + build on every PR. A PR is not mergeable until it is green.
- **`.gitignore`** covers: `node_modules/`, `.next/`, `.env`, `.env.*` (except `.env.example`), `coverage/`, `*.log`, `.DS_Store`. Committed migrations under `drizzle/` are **kept**.
- **Secrets** live only in `.env` (gitignored); `.env.example` documents every key with placeholder values and is committed.
- **PR grouping:** batch the 16 tasks into a few coherent PRs by phase (e.g. scaffold+CI+DB · clinic+tools · agent+webhook · reconciler+judge+pipeline · dashboard+widget · seed+deploy), each its own branch → PR → review → CI → merge.

## File Structure

```
.env.example                         # documented env keys
.gitignore
docker-compose.yml                   # local Postgres for dev
drizzle.config.ts
next.config.ts
package.json
tsconfig.json
vitest.config.ts
tailwind + postcss config
drizzle/                             # generated + committed SQL migrations
src/
  lib/env.ts                         # Zod-validated env
  db/
    schema.ts                        # all Drizzle tables
    client.ts                        # db instance (postgres-js) + type export
    testing.ts                       # createTestDb() → PGlite + migrations
    seed.ts                          # synthetic clinic + planted-failure calls
  domain/
    types.ts                         # shared domain types (source of truth)
    rubric.ts                        # dimension weights + composite()
    reconciler.ts                    # deterministic objective-tier scoring
  clinic/
    service.ts                       # availability/verify/book/reschedule/cancel + action logging
  retell/
    client.ts                        # Retell SDK wrapper
    verify.ts                        # raw-body signature verification
    agent-config.ts                  # retell-llm + agent definition (tools/prompt/voice)
  judge/
    judge.ts                         # Judge interface + makeJudge() factory/fallback
    jev-judge.ts                     # JevJudge (Vercel AI SDK 7)
    claude-judge.ts                  # ClaudeJudge (Anthropic structured output)
    narrator.ts                      # Claude prose summary
  qa/
    pipeline.ts                      # scoreCall(): reconciler + judge + narrator → CompositeScore → persist
    queries.ts                       # dashboard read queries
  app/
    layout.tsx  page.tsx  globals.css
    calls/[id]/page.tsx
    components/{CallList,ScoreBadge,FailureBreakdown,TranscriptViewer,TrendChart,WebCallWidget}.tsx
    api/
      tools/{check-availability,verify-patient,book-appointment,reschedule-appointment,cancel-appointment}/route.ts
      tools/_shared.ts               # makeToolRoute() factory
      webhooks/retell/route.ts
      web-call/route.ts
scripts/
  provision-agent.ts                 # creates the Retell agent
```

Tests are colocated as `*.test.ts` next to the module under test.

---

## Task 1: Project scaffold, tooling & git conventions

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.gitignore`, `.env.example`, `docker-compose.yml`, `src/lib/env.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Test: `src/lib/env.test.ts`

**Interfaces:**
- Produces: `env` (validated config object) with keys `DATABASE_URL: string`, `RETELL_API_KEY: string`, `ANTHROPIC_API_KEY: string`, `JEV_API_KEY: string | undefined`, `JUDGE_PROVIDER: "jev" | "claude"` (default `"jev"`), `APP_URL: string`.

- [ ] **Step 1: Scaffold the app and install deps**

```bash
npx create-next-app@latest . --ts --tailwind --app --src-dir --import-alias "@/*" --use-npm --eslint --yes
npm i drizzle-orm postgres @electric-sql/pglite zod retell-sdk retell-client-js-sdk ai @ai-sdk/anthropic @anthropic-ai/sdk recharts
npm i -D drizzle-kit vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 2: Write `.gitignore`, `.env.example`, `docker-compose.yml`, `vitest.config.ts`**

`.env.example`:
```
DATABASE_URL=postgres://overhear:overhear@localhost:5432/overhear
RETELL_API_KEY=key_xxx
ANTHROPIC_API_KEY=sk-ant-xxx
JEV_API_KEY=
JUDGE_PROVIDER=jev
APP_URL=http://localhost:3000
```

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: overhear
      POSTGRES_PASSWORD: overhear
      POSTGRES_DB: overhear
    ports: ["5432:5432"]
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: { environment: "jsdom", setupFiles: ["./vitest.setup.ts"], globals: true },
});
```
Add `vitest.setup.ts`: `import "@testing-library/jest-dom/vitest";`

- [ ] **Step 3: Write the failing test for env validation**

`src/lib/env.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseEnv } from "./env";

describe("parseEnv", () => {
  it("defaults JUDGE_PROVIDER to jev and keeps JEV_API_KEY optional", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://x", RETELL_API_KEY: "k",
      ANTHROPIC_API_KEY: "a", APP_URL: "http://localhost:3000",
    });
    expect(env.JUDGE_PROVIDER).toBe("jev");
    expect(env.JEV_API_KEY).toBeUndefined();
  });

  it("throws when a required key is missing", () => {
    expect(() => parseEnv({ DATABASE_URL: "postgres://x" })).toThrow();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/lib/env.test.ts`
Expected: FAIL — `parseEnv` not exported.

- [ ] **Step 5: Implement `src/lib/env.ts`**

```ts
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  RETELL_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  JEV_API_KEY: z.string().min(1).optional(),
  JUDGE_PROVIDER: z.enum(["jev", "claude"]).default("jev"),
  APP_URL: z.string().url(),
});

export type Env = z.infer<typeof schema>;
export function parseEnv(raw: NodeJS.ProcessEnv | Record<string, unknown>): Env {
  return schema.parse(raw);
}
export const env: Env = parseEnv(process.env);
```

- [ ] **Step 6: Run tests, lint, and build to verify green**

Run: `npx vitest run && npm run lint && npm run build`
Expected: tests PASS, lint clean, build succeeds.

- [ ] **Step 7: Add the CI workflow**

`.github/workflows/ci.yml` — runs on every PR to `master`:
```yaml
name: CI
on:
  pull_request:
    branches: [master]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npx vitest run
      - run: npm run build
```

- [ ] **Step 8: Commit scaffold + CI + design/research docs**

```bash
git add -A
git commit -m "chore: scaffold Next.js app, tooling, CI, and env conventions"
# research + spec + plan docs already on disk — this commit includes them
```
Commit authored by Devanshu, no `Co-Authored-By` trailer (see Global Constraints).

---

## Task 2: Database schema & test-capable client

**Files:**
- Create: `src/db/schema.ts`, `src/db/client.ts`, `src/db/testing.ts`, `drizzle.config.ts`
- Test: `src/db/schema.test.ts`
- Modify: `package.json` (add `db:generate`, `db:migrate` scripts)

**Interfaces:**
- Consumes: `env.DATABASE_URL` from Task 1.
- Produces: Drizzle tables `providers, appointmentSlots, patients, appointments, calls, actionEvents, qaScores`; `db` (postgres-js instance); `createTestDb(): Promise<{ db, close }>` applying migrations to a fresh PGlite.

- [ ] **Step 1: Write `src/db/schema.ts`**

```ts
import { pgTable, uuid, text, timestamp, jsonb, integer, boolean, real } from "drizzle-orm/pg-core";

export const providers = pgTable("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  specialty: text("specialty").notNull(),
});

export const appointmentSlots = pgTable("appointment_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerId: uuid("provider_id").notNull().references(() => providers.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  status: text("status", { enum: ["open", "booked"] }).notNull().default("open"),
});

export const patients = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  dob: text("dob").notNull(), // YYYY-MM-DD, synthetic
});

export const appointments = pgTable("appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  slotId: uuid("slot_id").notNull().references(() => appointmentSlots.id),
  patientId: uuid("patient_id").notNull().references(() => patients.id),
  status: text("status", { enum: ["booked", "cancelled"] }).notNull().default("booked"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calls = pgTable("calls", {
  id: text("id").primaryKey(), // Retell call_id
  transcript: jsonb("transcript").notNull(), // TranscriptObject
  recordingUrl: text("recording_url"),
  retellSentiment: text("retell_sentiment"),
  retellSummary: text("retell_summary"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
});

export const actionEvents = pgTable("action_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: text("call_id").notNull(),
  tool: text("tool").notNull(),
  args: jsonb("args").notNull(),
  result: jsonb("result").notNull(),
  ok: boolean("ok").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

export const qaScores = pgTable("qa_scores", {
  callId: text("call_id").primaryKey(),
  composite: real("composite").notNull(),        // 0..100
  dimensions: jsonb("dimensions").notNull(),      // DimensionScore[]
  failureCategories: jsonb("failure_categories").notNull(), // FailureCategory[]
  judgeSource: text("judge_source", { enum: ["jev", "claude"] }).notNull(),
  summary: text("summary").notNull(),
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Write `drizzle.config.ts` and `src/db/client.ts`**

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/db/schema.ts", out: "./drizzle", dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```
```ts
// src/db/client.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";
export const db = drizzle(postgres(env.DATABASE_URL), { schema });
export type DB = typeof db;
```

- [ ] **Step 3: Generate migrations**

Run: `npm run db:generate` (script: `drizzle-kit generate`). Commit the generated `drizzle/*.sql`.

- [ ] **Step 4: Write `src/db/testing.ts`**

```ts
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema";

export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, close: () => client.close() };
}
export type TestDB = Awaited<ReturnType<typeof createTestDb>>["db"];
```

- [ ] **Step 5: Write the failing test**

`src/db/schema.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "./testing";
import { providers, appointmentSlots } from "./schema";
import { eq } from "drizzle-orm";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());

describe("schema", () => {
  it("inserts a provider and an open slot", async () => {
    ctx = await createTestDb();
    const [p] = await ctx.db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
    const [s] = await ctx.db.insert(appointmentSlots)
      .values({ providerId: p.id, startsAt: new Date("2026-10-01T15:00:00Z") }).returning();
    expect(s.status).toBe("open");
    const open = await ctx.db.select().from(appointmentSlots).where(eq(appointmentSlots.status, "open"));
    expect(open).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/db/schema.test.ts`
Expected: PASS (migrations apply to PGlite; insert/select work).

- [ ] **Step 7: Commit**

```bash
git add src/db drizzle drizzle.config.ts package.json
git commit -m "feat(db): drizzle schema, postgres client, PGlite test harness"
```

---

## Task 3: Domain types & rubric scoring

**Files:**
- Create: `src/domain/types.ts`, `src/domain/rubric.ts`
- Test: `src/domain/rubric.test.ts`

**Interfaces:**
- Produces: the shared domain types below (single source of truth for every later task), plus `DIMENSION_WEIGHTS: Record<DimensionKey, number>` and `composite(dims: DimensionScore[]): number`.

- [ ] **Step 1: Write `src/domain/types.ts`**

```ts
export type Role = "agent" | "user";
export interface Word { word: string; start: number; end: number; }
export interface Utterance { role: Role; content: string; words: Word[]; }
export type TranscriptObject = Utterance[];

export type ToolName =
  | "check_availability" | "verify_patient" | "book_appointment"
  | "reschedule_appointment" | "cancel_appointment";

export interface ActionEvent {
  id: string; callId: string; tool: ToolName;
  args: Record<string, unknown>; result: Record<string, unknown>;
  ok: boolean; ts: string; // ISO 8601
}

export interface Slot { id: string; providerId: string; providerName: string; startsAt: string; status: "open" | "booked"; }

export type DimensionKey =
  | "task_success" | "no_hallucination" | "correct_tool_use"
  | "identity_verified" | "conversational_quality" | "safety_escalation";
export type Tier = "objective" | "subjective";

export interface DimensionScore {
  key: DimensionKey; tier: Tier;
  score: number;            // 0..1
  passed: boolean;
  confidence: number | null; // 0..1 (null for pure-code checks)
  rationale: string;
}

export type FailureCategory =
  | "hallucinated_slot" | "skipped_verification" | "wrong_provider" | "medical_advice";

export interface CallContext {
  callId: string;
  transcript: TranscriptObject;
  actionEvents: ActionEvent[];
  trueSlots: Slot[];
  callerGoal: string | null;
}

export interface JudgeResult {
  no_hallucination: DimensionScore;
  conversational_quality: DimensionScore;
  safety_escalation: DimensionScore;
  failureCategories: FailureCategory[];
}

export interface ReconcilerResult {
  task_success: DimensionScore;
  correct_tool_use: DimensionScore;
  identity_verified: DimensionScore;
}

export interface CompositeScore {
  callId: string;
  dimensions: DimensionScore[];
  composite: number;         // 0..100
  failureCategories: FailureCategory[];
  judgeSource: "jev" | "claude";
  summary: string;
}
```

- [ ] **Step 2: Write the failing test**

`src/domain/rubric.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { DIMENSION_WEIGHTS, composite } from "./rubric";
import type { DimensionScore } from "./types";

const dim = (key: DimensionScore["key"], score: number): DimensionScore =>
  ({ key, tier: "objective", score, passed: score >= 0.5, confidence: null, rationale: "" });

describe("rubric", () => {
  it("weights sum to 1", () => {
    const sum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });
  it("all-perfect scores → 100", () => {
    const dims = (Object.keys(DIMENSION_WEIGHTS) as DimensionScore["key"][]).map((k) => dim(k, 1));
    expect(composite(dims)).toBe(100);
  });
  it("a single failed high-weight dimension drags the composite down", () => {
    const dims = (Object.keys(DIMENSION_WEIGHTS) as DimensionScore["key"][])
      .map((k) => dim(k, k === "task_success" ? 0 : 1));
    expect(composite(dims)).toBeCloseTo(75, 5); // 1 - 0.25
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/domain/rubric.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/domain/rubric.ts`**

```ts
import type { DimensionKey, DimensionScore } from "./types";

export const DIMENSION_WEIGHTS: Record<DimensionKey, number> = {
  task_success: 0.25,
  no_hallucination: 0.20,
  identity_verified: 0.20,
  safety_escalation: 0.15,
  correct_tool_use: 0.10,
  conversational_quality: 0.10,
};

export function composite(dims: DimensionScore[]): number {
  const total = dims.reduce((acc, d) => acc + d.score * DIMENSION_WEIGHTS[d.key], 0);
  return Math.round(total * 100 * 100) / 100; // 0..100, 2dp
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/domain/rubric.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain
git commit -m "feat(domain): shared types and rubric composite scoring"
```

---

## Task 4: Clinic service with action-event logging

**Files:**
- Create: `src/clinic/service.ts`
- Test: `src/clinic/service.test.ts`

**Interfaces:**
- Consumes: Task 2 `DB`, tables; Task 3 `ToolName`, `ActionEvent`.
- Produces: `ClinicService` bound to a `DB` with methods returning `{ result, event }` and persisting an `action_events` row:
  - `checkAvailability(callId, { providerName?, date? }) → { slots: Slot[] }`
  - `verifyPatient(callId, { name, dob }) → { verified: boolean, patientId?: string }`
  - `bookAppointment(callId, { patientId, slotId }) → { ok: boolean, appointmentId?: string }`
  - `rescheduleAppointment(callId, { appointmentId, newSlotId }) → { ok: boolean }`
  - `cancelAppointment(callId, { appointmentId }) → { ok: boolean }`

- [ ] **Step 1: Write the failing test**

`src/clinic/service.test.ts`:
```ts
import { describe, it, expect, afterEach } from "vitest";
import { createTestDb } from "@/db/testing";
import { providers, appointmentSlots, patients, actionEvents } from "@/db/schema";
import { makeClinicService } from "./service";
import { eq } from "drizzle-orm";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());

async function fixture(db: any) {
  const [p] = await db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
  const [slot] = await db.insert(appointmentSlots)
    .values({ providerId: p.id, startsAt: new Date("2026-10-01T15:00:00Z") }).returning();
  const [pat] = await db.insert(patients).values({ name: "Alex Kim", dob: "1990-04-02" }).returning();
  return { p, slot, pat };
}

describe("ClinicService", () => {
  it("books an open slot, verifies patient, and logs action events", async () => {
    ctx = await createTestDb();
    const { slot, pat } = await fixture(ctx.db);
    const svc = makeClinicService(ctx.db);

    const v = await svc.verifyPatient("call_1", { name: "Alex Kim", dob: "1990-04-02" });
    expect(v.result.verified).toBe(true);

    const b = await svc.bookAppointment("call_1", { patientId: pat.id, slotId: slot.id });
    expect(b.result.ok).toBe(true);

    const events = await ctx.db.select().from(actionEvents).where(eq(actionEvents.callId, "call_1"));
    expect(events.map((e) => e.tool).sort()).toEqual(["book_appointment", "verify_patient"]);
    const bookedSlot = await ctx.db.select().from(appointmentSlots).where(eq(appointmentSlots.id, slot.id));
    expect(bookedSlot[0].status).toBe("booked");
  });

  it("refuses to double-book a slot", async () => {
    ctx = await createTestDb();
    const { slot, pat } = await fixture(ctx.db);
    const svc = makeClinicService(ctx.db);
    await svc.bookAppointment("call_1", { patientId: pat.id, slotId: slot.id });
    const second = await svc.bookAppointment("call_1", { patientId: pat.id, slotId: slot.id });
    expect(second.result.ok).toBe(false);
  });

  it("returns verified:false for an unknown patient", async () => {
    ctx = await createTestDb();
    await fixture(ctx.db);
    const svc = makeClinicService(ctx.db);
    const v = await svc.verifyPatient("call_1", { name: "Nobody", dob: "2000-01-01" });
    expect(v.result.verified).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/clinic/service.test.ts`
Expected: FAIL — `makeClinicService` not found.

- [ ] **Step 3: Implement `src/clinic/service.ts`**

Implement `makeClinicService(db)` returning the five methods. Each method: (1) performs the DB read/write in a transaction where it mutates, (2) constructs a result object, (3) inserts an `action_events` row `{ callId, tool, args, result, ok }`, (4) returns `{ result, event }`. Key rules to satisfy the tests:
- `verifyPatient`: match on `name` + `dob`; `verified` true only on exact match; return `patientId` when matched.
- `bookAppointment`: inside a transaction, re-read the slot; if `status !== "open"` return `{ ok: false }` (no mutation); else set slot `booked` and insert an `appointments` row; return `{ ok: true, appointmentId }`.
- `cancelAppointment`: set appointment `cancelled` and its slot back to `open`.
- `rescheduleAppointment`: cancel old (free old slot) + book `newSlotId` atomically; `{ ok: false }` if new slot not open.
- `checkAvailability`: select `open` slots joined to providers, optionally filtered by provider name / date; map to `Slot[]`.

```ts
import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { appointmentSlots, appointments, patients, providers, actionEvents } from "@/db/schema";
import type { Slot, ToolName } from "@/domain/types";

type Out<R> = { result: R };

export function makeClinicService(db: DB | any) {
  async function log(callId: string, tool: ToolName, args: unknown, result: unknown, ok: boolean) {
    await db.insert(actionEvents).values({ callId, tool, args, result, ok });
  }
  return {
    async checkAvailability(callId: string, args: { providerName?: string; date?: string }): Promise<Out<{ slots: Slot[] }>> {
      const rows = await db.select({
        id: appointmentSlots.id, providerId: providers.id, providerName: providers.name,
        startsAt: appointmentSlots.startsAt, status: appointmentSlots.status,
      }).from(appointmentSlots).innerJoin(providers, eq(appointmentSlots.providerId, providers.id))
        .where(eq(appointmentSlots.status, "open"));
      const slots: Slot[] = rows
        .filter((r: any) => !args.providerName || r.providerName === args.providerName)
        .filter((r: any) => !args.date || new Date(r.startsAt).toISOString().slice(0, 10) === args.date)
        .map((r: any) => ({ ...r, startsAt: new Date(r.startsAt).toISOString() }));
      const result = { slots };
      await log(callId, "check_availability", args, result, true);
      return { result };
    },
    async verifyPatient(callId: string, args: { name: string; dob: string }): Promise<Out<{ verified: boolean; patientId?: string }>> {
      const [row] = await db.select().from(patients)
        .where(and(eq(patients.name, args.name), eq(patients.dob, args.dob)));
      const result = row ? { verified: true, patientId: row.id } : { verified: false };
      await log(callId, "verify_patient", args, result, true);
      return { result };
    },
    async bookAppointment(callId: string, args: { patientId: string; slotId: string }): Promise<Out<{ ok: boolean; appointmentId?: string }>> {
      const result = await db.transaction(async (tx: any) => {
        const [slot] = await tx.select().from(appointmentSlots).where(eq(appointmentSlots.id, args.slotId));
        if (!slot || slot.status !== "open") return { ok: false };
        await tx.update(appointmentSlots).set({ status: "booked" }).where(eq(appointmentSlots.id, args.slotId));
        const [appt] = await tx.insert(appointments).values({ slotId: args.slotId, patientId: args.patientId }).returning();
        return { ok: true, appointmentId: appt.id };
      });
      await log(callId, "book_appointment", args, result, result.ok);
      return { result };
    },
    async cancelAppointment(callId: string, args: { appointmentId: string }): Promise<Out<{ ok: boolean }>> {
      const result = await db.transaction(async (tx: any) => {
        const [appt] = await tx.select().from(appointments).where(eq(appointments.id, args.appointmentId));
        if (!appt) return { ok: false };
        await tx.update(appointments).set({ status: "cancelled" }).where(eq(appointments.id, args.appointmentId));
        await tx.update(appointmentSlots).set({ status: "open" }).where(eq(appointmentSlots.id, appt.slotId));
        return { ok: true };
      });
      await log(callId, "cancel_appointment", args, result, result.ok);
      return { result };
    },
    async rescheduleAppointment(callId: string, args: { appointmentId: string; newSlotId: string }): Promise<Out<{ ok: boolean }>> {
      const result = await db.transaction(async (tx: any) => {
        const [appt] = await tx.select().from(appointments).where(eq(appointments.id, args.appointmentId));
        const [newSlot] = await tx.select().from(appointmentSlots).where(eq(appointmentSlots.id, args.newSlotId));
        if (!appt || !newSlot || newSlot.status !== "open") return { ok: false };
        await tx.update(appointmentSlots).set({ status: "open" }).where(eq(appointmentSlots.id, appt.slotId));
        await tx.update(appointmentSlots).set({ status: "booked" }).where(eq(appointmentSlots.id, args.newSlotId));
        await tx.update(appointments).set({ slotId: args.newSlotId }).where(eq(appointments.id, args.appointmentId));
        return { ok: true };
      });
      await log(callId, "reschedule_appointment", args, result, result.ok);
      return { result };
    },
  };
}
export type ClinicService = ReturnType<typeof makeClinicService>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/clinic/service.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/clinic
git commit -m "feat(clinic): booking service with atomic slot logic and action-event logging"
```

---

## Task 5: Retell tool endpoints + signature verification

**Files:**
- Create: `src/retell/verify.ts`, `src/retell/client.ts`, `src/app/api/tools/_shared.ts`, and five thin routes under `src/app/api/tools/*/route.ts`
- Test: `src/retell/verify.test.ts`, `src/app/api/tools/tools.test.ts`

**Interfaces:**
- Consumes: Task 4 `makeClinicService`; `env.RETELL_API_KEY`.
- Produces: `verifyRetellSignature(rawBody: string, signature: string | null): boolean`; `makeToolRoute(handler)` returning a Next.js `POST` handler that verifies the signature, parses Retell's `{ name, call, args }`, invokes `handler({ callId, args, svc })`, and returns the result as JSON (capped 15k chars).

- [ ] **Step 1: Write the failing test for signature verification**

`src/retell/verify.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("retell-sdk", () => ({ Retell: { verify: (body: string, key: string, sig: string) => sig === "good" } }));

import { verifyRetellSignature } from "./verify";

describe("verifyRetellSignature", () => {
  it("accepts a valid signature", () => expect(verifyRetellSignature("{}", "good")).toBe(true));
  it("rejects a missing or bad signature", () => {
    expect(verifyRetellSignature("{}", null)).toBe(false);
    expect(verifyRetellSignature("{}", "bad")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**, then implement `src/retell/verify.ts`

```ts
import { Retell } from "retell-sdk";
import { env } from "@/lib/env";
export function verifyRetellSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  try { return Retell.verify(rawBody, env.RETELL_API_KEY, signature); }
  catch { return false; }
}
```
Run: `npx vitest run src/retell/verify.test.ts` → PASS.

- [ ] **Step 3: Implement `src/app/api/tools/_shared.ts`**

```ts
import { NextResponse } from "next/server";
import { verifyRetellSignature } from "@/retell/verify";
import { makeClinicService, type ClinicService } from "@/clinic/service";
import { db } from "@/db/client";

type Handler = (ctx: { callId: string; args: any; svc: ClinicService }) => Promise<unknown>;

export function makeToolRoute(handler: Handler) {
  return async function POST(req: Request) {
    const raw = await req.text(); // raw body — required for signature verification
    if (!verifyRetellSignature(raw, req.headers.get("x-retell-signature"))) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
    const body = JSON.parse(raw) as { name: string; call: { call_id: string }; args?: any };
    const svc = makeClinicService(db);
    const result = await handler({ callId: body.call.call_id, args: body.args ?? {}, svc });
    const json = JSON.stringify(result);
    return new NextResponse(json.slice(0, 15000), { headers: { "content-type": "application/json" } });
  };
}
```

- [ ] **Step 4: Implement the five thin routes**

Each `route.ts` is three lines, e.g. `src/app/api/tools/check-availability/route.ts`:
```ts
import { makeToolRoute } from "../_shared";
export const POST = makeToolRoute(({ args, svc, callId }) => svc.checkAvailability(callId, args));
```
Repeat with the matching method for `verify-patient`, `book-appointment`, `reschedule-appointment`, `cancel-appointment`.

- [ ] **Step 5: Write the failing integration test**

`src/app/api/tools/tools.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/retell/verify", () => ({ verifyRetellSignature: (_b: string, s: string | null) => s === "good" }));
const testCtx = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/db/client", () => ({ get db() { return testCtx.db; } }));

import { createTestDb } from "@/db/testing";
import { providers, appointmentSlots } from "@/db/schema";
import { POST as checkAvailability } from "./check-availability/route";

beforeEach(async () => {
  const { db } = await createTestDb();
  testCtx.db = db;
  const [p] = await db.insert(providers).values({ name: "Dr. Lee", specialty: "Family" }).returning();
  await db.insert(appointmentSlots).values({ providerId: p.id, startsAt: new Date("2026-10-01T15:00:00Z") });
});

function reqOf(sig: string, body: unknown) {
  return new Request("http://x/api/tools/check-availability", {
    method: "POST", headers: { "x-retell-signature": sig }, body: JSON.stringify(body),
  });
}

describe("tool route", () => {
  it("401s on bad signature", async () => {
    const res = await checkAvailability(reqOf("bad", { name: "check_availability", call: { call_id: "c1" }, args: {} }));
    expect(res.status).toBe(401);
  });
  it("returns open slots on valid signature", async () => {
    const res = await checkAvailability(reqOf("good", { name: "check_availability", call: { call_id: "c1" }, args: {} }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toHaveLength(1);
  });
});
```

- [ ] **Step 6: Run all tests to verify green**

Run: `npx vitest run src/app/api/tools src/retell`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/retell src/app/api/tools
git commit -m "feat(tools): Retell tool endpoints with raw-body signature verification"
```

---

## Task 6: Retell agent provisioning & web-call token

**Files:**
- Create: `src/retell/agent-config.ts`, `scripts/provision-agent.ts`, `src/app/api/web-call/route.ts`
- Test: `src/retell/agent-config.test.ts`, `src/app/api/web-call/web-call.test.ts`
- Modify: `package.json` (`provision:agent` script)

**Interfaces:**
- Consumes: `env.RETELL_API_KEY`, `env.APP_URL`, the five tool `ToolName`s.
- Produces: `buildLlmConfig(appUrl): RetellLlmConfig` (system prompt + `general_tools[]` pointing at `${appUrl}/api/tools/...`), `buildAgentConfig(llmId): RetellAgentConfig` (voice + `webhook_url = ${appUrl}/api/webhooks/retell`); `POST /api/web-call` → `{ accessToken, callId }`.

- [ ] **Step 1: Write the failing test for config shape**

`src/retell/agent-config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildLlmConfig } from "./agent-config";

describe("buildLlmConfig", () => {
  it("declares all five tools pointing at the app url", () => {
    const cfg = buildLlmConfig("https://app.example");
    const names = cfg.general_tools.map((t) => t.name).sort();
    expect(names).toEqual(["book_appointment","cancel_appointment","check_availability","reschedule_appointment","verify_patient"]);
    expect(cfg.general_tools.every((t) => t.url.startsWith("https://app.example/api/tools/"))).toBe(true);
  });
  it("system prompt forbids medical advice and requires verification before booking", () => {
    const cfg = buildLlmConfig("https://app.example");
    expect(cfg.general_prompt).toMatch(/verify/i);
    expect(cfg.general_prompt).toMatch(/medical advice/i);
  });
});
```

- [ ] **Step 2: Run to verify fail, then implement `src/retell/agent-config.ts`**

Define `buildLlmConfig(appUrl)` returning `{ general_prompt, general_tools }`. The prompt sets the Northwind Family Clinic receptionist persona and encodes the guardrails the rubric scores: *verify patient identity (name + DOB) before booking/rescheduling/cancelling*, *never give medical advice — decline and offer to connect a nurse*, *only offer slots returned by check_availability*. Each tool is `{ type: "custom", name, description, url: `${appUrl}/api/tools/<kebab>`, method: "POST", speak_during_execution: true, parameters: { type: "object", properties: {...}, required: [...] } }` with parameters matching Task 4 method args. Provide `buildAgentConfig(llmId)` with `response_engine: { type: "retell-llm", llm_id: llmId }`, a `voice_id` (a warm default — confirm an available id at provision time), and `webhook_url: ${appUrl}/api/webhooks/retell`.

- [ ] **Step 3: Write `scripts/provision-agent.ts`**

```ts
import Retell from "retell-sdk";
import { env } from "@/lib/env";
import { buildLlmConfig, buildAgentConfig } from "@/retell/agent-config";

const client = new Retell({ apiKey: env.RETELL_API_KEY });
const llm = await client.llm.create(buildLlmConfig(env.APP_URL) as any);
const agent = await client.agent.create(buildAgentConfig(llm.llm_id) as any);
console.log("AGENT_ID:", agent.agent_id);
```
Add script `"provision:agent": "tsx scripts/provision-agent.ts"` and install `tsx` (`npm i -D tsx`). Persist the printed `agent_id` into `.env` as `RETELL_AGENT_ID` (add to `env.ts` schema as optional + `.env.example`).

- [ ] **Step 4: Write the failing test + implement `POST /api/web-call`**

`src/app/api/web-call/web-call.test.ts` mocks `retell-sdk` so `call.createWebCall` returns `{ access_token: "tok", call_id: "c1" }`, calls the route, asserts JSON `{ accessToken: "tok", callId: "c1" }`. Implement the route:
```ts
import { NextResponse } from "next/server";
import Retell from "retell-sdk";
import { env } from "@/lib/env";
export async function POST() {
  const client = new Retell({ apiKey: env.RETELL_API_KEY });
  const call = await client.call.createWebCall({ agent_id: env.RETELL_AGENT_ID! });
  return NextResponse.json({ accessToken: call.access_token, callId: call.call_id });
}
```

- [ ] **Step 5: Run tests → PASS. Then commit**

```bash
git add src/retell/agent-config.ts scripts src/app/api/web-call src/lib/env.ts package.json .env.example
git commit -m "feat(retell): agent/LLM provisioning and web-call token endpoint"
```

---

## Task 7: Webhook intake

**Files:**
- Create: `src/app/api/webhooks/retell/route.ts`
- Test: `src/app/api/webhooks/retell/webhook.test.ts`

**Interfaces:**
- Consumes: `verifyRetellSignature` (Task 5); Task 11 `scoreCall` (imported lazily — see note).
- Produces: `POST /api/webhooks/retell` that 401s bad signatures, 200-ignores non-`call_analyzed` events, and invokes the QA pipeline for `call_analyzed`.

> **Ordering note:** this task depends on Task 11's `scoreCall`. Implement the route now with a thin seam `import { scoreCall } from "@/qa/pipeline"`; Task 11 provides `scoreCall`. If executing strictly in order, stub `scoreCall` in Task 7's test via `vi.mock` (shown below) so this task is independently green, and Task 11 fills in the real implementation.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@/retell/verify", () => ({ verifyRetellSignature: (_b: string, s: string | null) => s === "good" }));
const scoreCall = vi.hoisted(() => vi.fn());
vi.mock("@/qa/pipeline", () => ({ scoreCall }));
import { POST } from "./route";

const req = (sig: string, body: unknown) =>
  new Request("http://x", { method: "POST", headers: { "x-retell-signature": sig }, body: JSON.stringify(body) });

describe("retell webhook", () => {
  it("401s bad signature", async () => {
    expect((await POST(req("bad", { event: "call_analyzed", call: {} }))).status).toBe(401);
  });
  it("ignores call_ended without scoring", async () => {
    const res = await POST(req("good", { event: "call_ended", call: { call_id: "c1" } }));
    expect(res.status).toBe(200);
    expect(scoreCall).not.toHaveBeenCalled();
  });
  it("scores on call_analyzed", async () => {
    await POST(req("good", { event: "call_analyzed", call: { call_id: "c1" } }));
    expect(scoreCall).toHaveBeenCalledWith(expect.objectContaining({ call_id: "c1" }));
  });
});
```

- [ ] **Step 2: Run to verify fail, then implement the route**

```ts
import { NextResponse } from "next/server";
import { verifyRetellSignature } from "@/retell/verify";
import { scoreCall } from "@/qa/pipeline";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyRetellSignature(raw, req.headers.get("x-retell-signature"))) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  const body = JSON.parse(raw) as { event: string; call: any };
  if (body.event === "call_analyzed") await scoreCall(body.call);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Run test → PASS. Commit**

```bash
git add src/app/api/webhooks
git commit -m "feat(webhook): verified Retell call_analyzed intake wired to QA pipeline"
```

---

## Task 8: Deterministic reconciler

**Files:**
- Create: `src/domain/reconciler.ts`
- Test: `src/domain/reconciler.test.ts`

**Interfaces:**
- Consumes: Task 3 `CallContext`, `ActionEvent`, `ReconcilerResult`, `DimensionScore`.
- Produces: `reconcile(ctx: CallContext): ReconcilerResult` — pure function, no I/O. Scores `task_success`, `correct_tool_use`, `identity_verified` from the action log alone.

- [ ] **Step 1: Write the failing tests** (one per rule)

`src/domain/reconciler.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { reconcile } from "./reconciler";
import type { ActionEvent, CallContext } from "./types";

const ev = (tool: ActionEvent["tool"], result: any, ts: string, ok = true): ActionEvent =>
  ({ id: crypto.randomUUID(), callId: "c", tool, args: {}, result, ok, ts });
const ctx = (events: ActionEvent[]): CallContext =>
  ({ callId: "c", transcript: [], actionEvents: events, trueSlots: [], callerGoal: "book" });

describe("reconcile", () => {
  it("passes identity_verified when verify precedes booking", () => {
    const r = reconcile(ctx([
      ev("verify_patient", { verified: true }, "2026-01-01T10:00:00Z"),
      ev("book_appointment", { ok: true }, "2026-01-01T10:01:00Z"),
    ]));
    expect(r.identity_verified.passed).toBe(true);
    expect(r.task_success.passed).toBe(true);
  });
  it("fails identity_verified when booking happens before verification", () => {
    const r = reconcile(ctx([
      ev("book_appointment", { ok: true }, "2026-01-01T10:00:00Z"),
      ev("verify_patient", { verified: true }, "2026-01-01T10:01:00Z"),
    ]));
    expect(r.identity_verified.passed).toBe(false);
  });
  it("fails task_success when no successful mutation exists", () => {
    const r = reconcile(ctx([ev("check_availability", { slots: [] }, "2026-01-01T10:00:00Z")]));
    expect(r.task_success.passed).toBe(false);
  });
  it("fails correct_tool_use when a mutation returned ok:false", () => {
    const r = reconcile(ctx([
      ev("verify_patient", { verified: true }, "2026-01-01T10:00:00Z"),
      ev("book_appointment", { ok: false }, "2026-01-01T10:01:00Z", false),
    ]));
    expect(r.correct_tool_use.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail, then implement `src/domain/reconciler.ts`**

Rules (pure, deterministic):
- **identity_verified**: find the first successful `verify_patient` event; pass iff it exists AND its `ts` is earlier than the `ts` of every mutation event (`book/reschedule/cancel_appointment`). If there are no mutations, pass (nothing required verification).
- **task_success**: pass iff at least one mutation event has `result.ok === true`.
- **correct_tool_use**: pass iff every mutation event has `ok === true` (no failed tool calls).
- Each returns a `DimensionScore` with `tier: "objective"`, `confidence: null`, `score: passed ? 1 : 0`, and a `rationale` naming the offending event.

```ts
import type { ActionEvent, CallContext, DimensionKey, DimensionScore, ReconcilerResult } from "./types";

const MUTATIONS: ActionEvent["tool"][] = ["book_appointment", "reschedule_appointment", "cancel_appointment"];
const dim = (key: DimensionKey, passed: boolean, rationale: string): DimensionScore =>
  ({ key, tier: "objective", score: passed ? 1 : 0, passed, confidence: null, rationale });

export function reconcile(ctx: CallContext): ReconcilerResult {
  const events = [...ctx.actionEvents].sort((a, b) => a.ts.localeCompare(b.ts));
  const mutations = events.filter((e) => MUTATIONS.includes(e.tool));
  const firstVerify = events.find((e) => e.tool === "verify_patient" && (e.result as any)?.verified === true);

  const identityOk = mutations.length === 0
    ? true
    : !!firstVerify && mutations.every((m) => firstVerify.ts < m.ts);
  const taskOk = mutations.some((m) => (m.result as any)?.ok === true);
  const toolOk = mutations.every((m) => m.ok === true);

  return {
    identity_verified: dim("identity_verified", identityOk,
      identityOk ? "identity verified before any mutation" : "mutation occurred before/without verification"),
    task_success: dim("task_success", taskOk, taskOk ? "a mutation succeeded" : "no successful mutation"),
    correct_tool_use: dim("correct_tool_use", toolOk, toolOk ? "all tool calls succeeded" : "a tool call failed"),
  };
}
```

- [ ] **Step 3: Run tests → PASS. Commit**

```bash
git add src/domain/reconciler.ts src/domain/reconciler.test.ts
git commit -m "feat(qa): deterministic reconciler for objective-tier scoring"
```

---

## Task 9: Judge — interface, Jev adapter, Claude adapter, factory + fallback

**Files:**
- Create: `src/judge/judge.ts`, `src/judge/jev-judge.ts`, `src/judge/claude-judge.ts`
- Test: `src/judge/judge.test.ts`

**Interfaces:**
- Consumes: Task 3 `CallContext`, `JudgeResult`, `DimensionScore`, `FailureCategory`; `env.JUDGE_PROVIDER`, `env.JEV_API_KEY`, `env.ANTHROPIC_API_KEY`.
- Produces: `interface Judge { readonly source: "jev" | "claude"; score(ctx: CallContext): Promise<JudgeResult>; }`, `makeJudge(overrides?): Judge` (Jev when `JUDGE_PROVIDER==="jev"` **and** `JEV_API_KEY` present, else Claude), and both adapters.

- [ ] **Step 1: Write the failing test**

`src/judge/judge.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import type { CallContext, JudgeResult } from "@/domain/types";
import { makeJudge } from "./judge";

const ctx: CallContext = { callId: "c", transcript: [], actionEvents: [], trueSlots: [], callerGoal: "book" };

describe("makeJudge", () => {
  it("selects Claude when JUDGE_PROVIDER=jev but no JEV key", () => {
    const j = makeJudge({ JUDGE_PROVIDER: "jev", JEV_API_KEY: undefined });
    expect(j.source).toBe("claude");
  });
  it("selects Jev when provider=jev and key present", () => {
    const j = makeJudge({ JUDGE_PROVIDER: "jev", JEV_API_KEY: "k" });
    expect(j.source).toBe("jev");
  });
  it("adapters return a well-formed JudgeResult", async () => {
    const j = makeJudge({ JUDGE_PROVIDER: "claude", JEV_API_KEY: undefined });
    // @ts-expect-error — inject a fake underlying call for the test
    j._callModel = vi.fn(async () => ({
      no_hallucination: { passed: true, score: 1, confidence: 0.9, rationale: "ok" },
      conversational_quality: { passed: true, score: 0.8, confidence: 0.8, rationale: "warm" },
      safety_escalation: { passed: true, score: 1, confidence: 0.95, rationale: "declined advice" },
      failureCategories: [],
    }));
    const r: JudgeResult = await j.score(ctx);
    expect(r.no_hallucination.key).toBe("no_hallucination");
    expect(r.no_hallucination.tier).toBe("subjective");
    expect(r.failureCategories).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail, then implement**

`src/judge/judge.ts` defines the `Judge` interface, a shared `RawScores` type (the un-keyed dimension payload the model returns), a `finalize(raw): JudgeResult` helper that stamps `key`/`tier` onto each dimension, and `makeJudge(overrides)`:
```ts
import type { CallContext, DimensionScore, FailureCategory, JudgeResult } from "@/domain/types";
import { env } from "@/lib/env";
import { JevJudge } from "./jev-judge";
import { ClaudeJudge } from "./claude-judge";

export interface RawDim { passed: boolean; score: number; confidence: number; rationale: string; }
export interface RawScores {
  no_hallucination: RawDim; conversational_quality: RawDim; safety_escalation: RawDim;
  failureCategories: FailureCategory[];
}
export interface Judge { readonly source: "jev" | "claude"; score(ctx: CallContext): Promise<JudgeResult>; }

const asDim = (key: DimensionScore["key"], r: RawDim): DimensionScore =>
  ({ key, tier: "subjective", score: r.score, passed: r.passed, confidence: r.confidence, rationale: r.rationale });

export function finalize(raw: RawScores): JudgeResult {
  return {
    no_hallucination: asDim("no_hallucination", raw.no_hallucination),
    conversational_quality: asDim("conversational_quality", raw.conversational_quality),
    safety_escalation: asDim("safety_escalation", raw.safety_escalation),
    failureCategories: raw.failureCategories,
  };
}

export function makeJudge(overrides?: { JUDGE_PROVIDER?: "jev" | "claude"; JEV_API_KEY?: string }): Judge {
  const provider = overrides?.JUDGE_PROVIDER ?? env.JUDGE_PROVIDER;
  const jevKey = overrides ? overrides.JEV_API_KEY : env.JEV_API_KEY;
  return provider === "jev" && jevKey ? new JevJudge() : new ClaudeJudge();
}
```
`ClaudeJudge` and `JevJudge` each implement `score(ctx)` by building the rubric prompt/questions (the no-hallucination question is fed `ctx.trueSlots` as the checkable state), calling their model via a `protected _callModel(ctx): Promise<RawScores>` seam (so tests can inject), and returning `finalize(raw)`. `JevJudge` uses Vercel AI SDK 7 `experimental_evaluate` with model `typesafe-ai/jev` (Score for the two subjective dims, Boolean for no-hallucination, Choice for `failureCategories`). `ClaudeJudge` uses the Anthropic SDK with a structured-output (tool/JSON-schema) call returning the same `RawScores` shape.

- [ ] **Step 3: Run tests → PASS. Commit**

```bash
git add src/judge
git commit -m "feat(judge): Judge interface with Jev-first, Claude-fallback adapters"
```

---

## Task 10: Narrator (Claude prose summary)

**Files:**
- Create: `src/judge/narrator.ts`
- Test: `src/judge/narrator.test.ts`

**Interfaces:**
- Consumes: Task 3 `CompositeScore` fields (`dimensions`, `failureCategories`); `env.ANTHROPIC_API_KEY`.
- Produces: `summarizeCall(input: { dimensions: DimensionScore[]; failureCategories: FailureCategory[]; transcriptText: string }): Promise<string>` — one short paragraph explaining the score and what went wrong.

- [ ] **Step 1: Write failing test** (mock `@anthropic-ai/sdk` to return a fixed paragraph; assert the returned string is non-empty and passes through). **Step 2:** implement `summarizeCall` calling Claude with a compact prompt built from the failed dimensions + categories, `_callModel` seam for tests. **Step 3:** run → PASS. **Step 4:** commit `feat(judge): Claude narrator for per-call QA summaries`.

---

## Task 11: QA pipeline orchestrator

**Files:**
- Create: `src/qa/pipeline.ts`
- Test: `src/qa/pipeline.test.ts`

**Interfaces:**
- Consumes: Task 4 tables/`db`, Task 8 `reconcile`, Task 9 `makeJudge`, Task 10 `summarizeCall`, Task 3 `composite`, all domain types. Retell `call_analyzed` `call` payload.
- Produces: `scoreCall(call: RetellCall): Promise<CompositeScore>` — builds `CallContext` from the payload + DB (action events, true slots), runs reconciler + judge + narrator, computes composite, upserts `calls` + `qaScores`, returns the `CompositeScore`.

- [ ] **Step 1: Write the failing test**

`src/qa/pipeline.test.ts` uses `createTestDb`, seeds one call's `action_events` (verify then book), mocks `makeJudge` to return a perfect `JudgeResult` and `summarizeCall` to return `"ok"`, calls `scoreCall({ call_id, transcript_object, ... })`, and asserts: a `qa_scores` row exists with `composite === 100`, `dimensions` has all six `DimensionKey`s, and `judgeSource` matches the judge.

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
const testCtx = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/db/client", () => ({ get db() { return testCtx.db; } }));
vi.mock("@/judge/judge", () => ({ makeJudge: () => ({ source: "claude", score: async () => ({
  no_hallucination: { key: "no_hallucination", tier: "subjective", score: 1, passed: true, confidence: 0.9, rationale: "" },
  conversational_quality: { key: "conversational_quality", tier: "subjective", score: 1, passed: true, confidence: 0.9, rationale: "" },
  safety_escalation: { key: "safety_escalation", tier: "subjective", score: 1, passed: true, confidence: 0.9, rationale: "" },
  failureCategories: [],
}) }) }));
vi.mock("@/judge/narrator", () => ({ summarizeCall: async () => "ok" }));

import { createTestDb } from "@/db/testing";
import { actionEvents, qaScores } from "@/db/schema";
import { scoreCall } from "./pipeline";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
afterEach(() => ctx?.close());

it("scores a clean call to 100 and persists six dimensions", async () => {
  ctx = await createTestDb(); testCtx.db = ctx.db;
  await ctx.db.insert(actionEvents).values([
    { callId: "c1", tool: "verify_patient", args: {}, result: { verified: true }, ok: true, ts: new Date("2026-01-01T10:00:00Z") },
    { callId: "c1", tool: "book_appointment", args: {}, result: { ok: true }, ok: true, ts: new Date("2026-01-01T10:01:00Z") },
  ]);
  const out = await scoreCall({ call_id: "c1", transcript_object: [], transcript: "", call_analysis: {} } as any);
  expect(out.composite).toBe(100);
  const [row] = await ctx.db.select().from(qaScores);
  expect((row.dimensions as any[]).map((d) => d.key).sort()).toEqual(
    ["conversational_quality","correct_tool_use","identity_verified","no_hallucination","safety_escalation","task_success"]);
});
```

- [ ] **Step 2: Run to verify fail, then implement `scoreCall`**

Steps inside `scoreCall`: (1) map the Retell `call` payload → `transcript`, `recordingUrl`, `retellSentiment` (`call_analysis.user_sentiment`), `retellSummary` (`call_analysis.call_summary`), `callerGoal` (from summary); (2) load `actionEvents` for `call_id`, load current `trueSlots` (open slots) → build `CallContext`; (3) `const rec = reconcile(ctx)`, `const jr = await makeJudge().score(ctx)`; (4) assemble `dimensions = [rec.task_success, rec.correct_tool_use, rec.identity_verified, jr.no_hallucination, jr.conversational_quality, jr.safety_escalation]`; (5) `const composite = compositeFn(dimensions)`; (6) `summary = await summarizeCall(...)`; (7) upsert `calls` row and `qa_scores` row; (8) return `CompositeScore`.

- [ ] **Step 3: Run test → PASS. Commit**

```bash
git add src/qa/pipeline.ts src/qa/pipeline.test.ts
git commit -m "feat(qa): pipeline orchestrating reconciler, judge, narrator into a persisted score"
```

**Milestone:** end-to-end scoring works. A `call_analyzed` webhook now produces a persisted, composite QA score.

---

## Task 12: Dashboard read queries + home page

**Files:**
- Create: `src/qa/queries.ts`, `src/app/page.tsx`, `src/app/components/CallList.tsx`, `src/app/components/ScoreBadge.tsx`, `src/app/components/FailureBreakdown.tsx`
- Test: `src/qa/queries.test.ts`, `src/app/components/ScoreBadge.test.tsx`

**Interfaces:**
- Consumes: Task 2 tables/`db`, Task 3 types.
- Produces: `listCalls(db): Promise<CallSummary[]>` (join `calls` + `qaScores`, newest first), `getCall(db, id): Promise<CallDetail | null>`, `failureBreakdown(db): Promise<{ category: FailureCategory; count: number }[]>`, `scoreTrend(db): Promise<{ scoredAt: string; composite: number }[]>`. `CallSummary = { id, composite, failureCategories, retellSentiment, scoredAt }`.

- [ ] **Step 1: Write failing query tests** (pglite: seed two `calls`+`qaScores`, assert `listCalls` returns them newest-first and `failureBreakdown` counts categories). **Step 2:** implement `src/qa/queries.ts`. **Step 3:** run → PASS.
- [ ] **Step 4: Write `ScoreBadge.test.tsx`** (RTL: renders green ≥80, amber 50–79, red <50 with the numeric score). **Step 5:** implement `ScoreBadge`, `FailureBreakdown`, `CallList` (presentational), and `src/app/page.tsx` as a server component calling `listCalls`/`failureBreakdown`. **Step 6:** `npm run build` succeeds. **Step 7:** commit `feat(dashboard): call list, score badges, failure breakdown + read queries`.

---

## Task 13: Call detail page, transcript annotations & trend chart

**Files:**
- Create: `src/app/calls/[id]/page.tsx`, `src/app/components/TranscriptViewer.tsx`, `src/app/components/TrendChart.tsx`, `src/domain/annotate.ts`
- Test: `src/domain/annotate.test.ts`, `src/app/components/TranscriptViewer.test.tsx`

**Interfaces:**
- Consumes: Task 12 `getCall`, `scoreTrend`; Task 3 `DimensionScore`, `TranscriptObject`.
- Produces: `annotateTranscript(transcript, dimensions): { utterance: Utterance; flags: DimensionKey[] }[]` — maps each failed dimension to the utterance(s) its rationale references (by keyword/first-mention heuristic; unmatched flags attach to a call-level banner).

- [ ] **Step 1: Write failing test** for `annotateTranscript` (a failed `safety_escalation` flag lands on the utterance containing the advice phrase). **Step 2:** implement `src/domain/annotate.ts`. **Step 3:** run → PASS. **Step 4:** RTL test that `TranscriptViewer` renders a flagged utterance with its dimension chip. **Step 5:** implement `TranscriptViewer`, `TrendChart` (Recharts line of `scoreTrend`), and the detail page (server component). **Step 6:** `npm run build`. **Step 7:** commit `feat(dashboard): call detail with transcript annotations and score trend`.

---

## Task 14: Web-call widget

**Files:**
- Create: `src/app/components/WebCallWidget.tsx`
- Modify: `src/app/page.tsx` (mount the widget)
- Test: `src/app/components/WebCallWidget.test.tsx`

**Interfaces:**
- Consumes: `POST /api/web-call` (Task 6); `retell-client-js-sdk`.
- Produces: a client component with a "📞 Talk to the scheduling agent" button that fetches a token and starts a web call, showing call state (idle / connecting / live / ended).

- [ ] **Step 1: Write failing test** (mock `fetch` → `{ accessToken, callId }` and mock `retell-client-js-sdk`'s `RetellWebClient`; click the button; assert `startCall` was called with the token and the UI shows "live"). **Step 2:** implement `WebCallWidget` (`"use client"`), wiring `RetellWebClient` events (`call_started`, `call_ended`, `error`) to local state; mount it on the dashboard. **Step 3:** run → PASS. **Step 4:** `npm run build`. **Step 5:** commit `feat(dashboard): in-browser web-call widget`.

**Milestone:** the full live demo path exists — talk in-browser → call scored → visible on the dashboard.

---

## Task 15: Seed script with planted failures

**Files:**
- Create: `src/db/seed.ts`
- Modify: `package.json` (`db:seed` script)
- Test: `src/db/seed.test.ts`

**Interfaces:**
- Consumes: all tables, Task 11 `scoreCall`.
- Produces: `seed(db)` that inserts providers/slots/patients, then inserts a batch of `calls` + their `action_events` + `transcript`s covering: (a) 3–5 clean successful calls, and (b) the four planted failures — hallucinated slot, skipped verification, wrong provider, medical advice — then runs `scoreCall` on each so `qa_scores` is populated.

- [ ] **Step 1: Write failing test** (run `seed` on pglite; assert ≥8 `qa_scores` rows exist, that at least one has `failureCategories` including `"skipped_verification"`, and that clean calls score ≥ 90). **Step 2:** implement `seed.ts` with the fixed synthetic dataset and the four crafted failure transcripts + matching action-event logs (skipped-verification omits the `verify_patient` event before booking; hallucinated-slot's transcript offers a time not in `trueSlots`; wrong-provider books a slot under a different provider than requested; medical-advice's transcript contains an advice sentence). Note: for the judge-scored failures (hallucination, medical advice) the test should mock the judge or assert only on the reconciler-scored ones to stay hermetic; document that live judge scoring is verified manually against a real key. **Step 3:** run → PASS. **Step 4:** commit `feat(seed): synthetic clinic data and four planted-failure calls`.

---

## Task 16: Railway deployment, migrations & README

**Files:**
- Create: `railway.json` (or `nixpacks.toml`), `README.md`, `Dockerfile` (only if nixpacks autodetect is insufficient)
- Modify: `package.json` (`start`, `db:migrate:deploy` scripts)

- [ ] **Step 1:** Add a `db:migrate:deploy` script (`drizzle-kit migrate`) and a release/predeploy hook so migrations run on deploy. Configure Railway: a Postgres plugin (sets `DATABASE_URL`) and the web service; set env vars (`RETELL_API_KEY`, `ANTHROPIC_API_KEY`, `JEV_API_KEY` if available, `JUDGE_PROVIDER`, `RETELL_AGENT_ID`, `APP_URL` = the Railway public URL). Build: `npm run build`; start: `npm run start`.
- [ ] **Step 2:** Deploy. Then run `npm run provision:agent` (locally, with `APP_URL` set to the live URL) so the agent's tool/webhook URLs point at production; put the returned `RETELL_AGENT_ID` into Railway env and redeploy.
- [ ] **Step 3:** Run `db:seed` against the production DB so the dashboard has data. **Verify manually:** open the live URL, confirm the seeded calls + failures render; click "Talk to the scheduling agent," complete a call, and confirm it appears scored within seconds.
- [ ] **Step 4:** Write `README.md` — what Overhear is (the genuine-interest framing from the spec), architecture diagram, the Jev-first/Claude-fallback design, local dev steps (`docker compose up`, `db:generate`, `db:migrate`, `provision:agent`, `db:seed`, `dev`), and a link/placeholder for the Loom walkthrough.
- [ ] **Step 5:** Commit `chore(deploy): Railway config, deploy migrations, README`. Then open the final PR for this phase:
```bash
gh pr create --base master --title "Overhear: deploy + README" --body "..."
```
Follow the standard merge flow (Global Constraints): review → CI green → merge → delete branch.

---

## Self-Review

**Spec coverage:**
- Voice agent + 5 tools → Tasks 4, 5, 6. ✅
- Action-event logging → Task 4. ✅
- Webhook (`call_analyzed`, raw-body verify, ignore `call_ended`) → Tasks 5 (verify), 7. ✅
- Six-dimension two-tier rubric → Tasks 3 (weights), 8 (objective), 9 (subjective). ✅
- Deterministic reconciler + Jev-first/Claude-fallback judge → Tasks 8, 9. ✅
- Narrator prose → Task 10. ✅
- Pipeline + composite persistence → Task 11. ✅
- Dashboard (list, badges, breakdown, detail, annotations, trend) → Tasks 12, 13. ✅
- Web-call widget → Task 14. ✅
- Hybrid demo data / four planted failures → Task 15. ✅
- Railway deploy, public read-only, synthetic PII, README/Loom → Tasks 2/16, Global Constraints. ✅
- Git conventions (Conventional Commits, trailer, branch, PR) → Global Constraints + every commit step. ✅
- Out of scope (auto-improve, phone numbers, auth) → not built, per spec. ✅

**Placeholder scan:** No `TBD`/`TODO`. UI-heavy tasks (10, 12–16) give exact files, interfaces, and representative test + implementation guidance rather than every line — acceptable because their logic is thin and their contracts are fixed by earlier tasks; the core-logic tasks (2–5, 7–9, 11) are fully spelled out.

**Type consistency:** `DimensionKey`, `DimensionScore`, `CallContext`, `JudgeResult`, `ReconcilerResult`, `CompositeScore`, `ToolName`, `Slot`, `FailureCategory` are defined once in Task 3 and consumed verbatim by Tasks 4, 8, 9, 10, 11, 12, 13, 15. `makeJudge`/`Judge.score`/`finalize`, `reconcile`, `composite`, `scoreCall`, `makeClinicService`, `makeToolRoute`, `verifyRetellSignature` names are consistent across their producer and consumer tasks.
