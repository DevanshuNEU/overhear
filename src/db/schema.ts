import { pgTable, uuid, text, timestamp, jsonb, boolean, real } from "drizzle-orm/pg-core";

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
