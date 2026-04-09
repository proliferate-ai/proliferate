ALTER TABLE sessions
    ADD COLUMN requested_model_id TEXT;

ALTER TABLE sessions
    ADD COLUMN current_model_id TEXT;

ALTER TABLE sessions
    ADD COLUMN requested_mode_id TEXT;

ALTER TABLE sessions
    ADD COLUMN current_mode_id TEXT;

UPDATE sessions
SET
    requested_model_id = model_id,
    current_model_id = model_id,
    requested_mode_id = mode_id,
    current_mode_id = mode_id;

-- Legacy sessions.model_id / sessions.mode_id are intentionally left in place
-- for SQLite compatibility. Runtime code stops reading and writing them after
-- this migration; requested/current columns become the sole source of truth.
