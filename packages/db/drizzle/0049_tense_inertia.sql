ALTER TABLE "session_events" DROP CONSTRAINT "session_events_type_check";--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_kind_check";--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "session_events" ADD COLUMN "actor_user_id" text;--> statement-breakpoint
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_type_check" CHECK (event_type = ANY (ARRAY['session_created'::text, 'session_started'::text, 'session_paused'::text, 'session_resumed'::text, 'session_completed'::text, 'session_failed'::text, 'session_cancelled'::text, 'session_outcome_persisted'::text]));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_kind_check" CHECK (kind IS NULL OR kind = ANY (ARRAY['manager'::text, 'task'::text, 'setup'::text]));