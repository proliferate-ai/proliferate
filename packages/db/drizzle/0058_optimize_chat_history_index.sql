-- Optimize chat history index: (session_id, created_at) enables a single ordered scan
-- instead of bitmap-OR across 4 event_type values with the previous 3-column index.
DROP INDEX IF EXISTS "idx_session_events_chat_history";
CREATE INDEX "idx_session_events_chat_history" ON "session_events" USING btree ("session_id", "created_at");
