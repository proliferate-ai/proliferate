-- K5: Session events lifecycle log table
CREATE TABLE IF NOT EXISTS "session_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_user_id" text,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_events_type_check" CHECK (event_type = ANY (ARRAY['session_started'::text, 'session_paused'::text, 'session_resumed'::text, 'session_completed'::text, 'session_failed'::text, 'session_cancelled'::text, 'session_outcome_persisted'::text]))
);

CREATE INDEX IF NOT EXISTS "idx_session_events_session" ON "session_events" USING btree ("session_id");
CREATE INDEX IF NOT EXISTS "idx_session_events_type" ON "session_events" USING btree ("event_type");

ALTER TABLE "session_events" ADD CONSTRAINT "session_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;
