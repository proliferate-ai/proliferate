-- K5: Add session_created to session_events CHECK constraint
ALTER TABLE "session_events" DROP CONSTRAINT IF EXISTS "session_events_type_check";
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_type_check" CHECK (event_type = ANY (ARRAY['session_created'::text, 'session_started'::text, 'session_paused'::text, 'session_resumed'::text, 'session_completed'::text, 'session_failed'::text, 'session_cancelled'::text, 'session_outcome_persisted'::text]));
