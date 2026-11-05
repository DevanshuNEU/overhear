ALTER TABLE "action_events" ADD COLUMN "tool_call_id" text;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "raw_call" jsonb;