DROP INDEX "idx_action_invocations_session";--> statement-breakpoint
ALTER TABLE "action_invocations" ALTER COLUMN "session_id" SET DATA TYPE uuid;--> statement-breakpoint
CREATE INDEX "idx_action_invocations_session" ON "action_invocations" USING btree ("session_id" uuid_ops);