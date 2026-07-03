-- Additive goal augmentation the native harness has no concept of: runtime
-- caps, provenance, the cap-guard bookkeeping and the typed failure reason.
-- All columns are additive with safe defaults so existing goal rows migrate in
-- place (source_kind backfills to 'user', guard_turns_used to 0).
ALTER TABLE goals ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'user';
ALTER TABLE goals ADD COLUMN source_run_id TEXT;
ALTER TABLE goals ADD COLUMN max_turns INTEGER;
ALTER TABLE goals ADD COLUMN max_wall_secs INTEGER;
ALTER TABLE goals ADD COLUMN failed_reason TEXT;
ALTER TABLE goals ADD COLUMN guard_turns_used INTEGER NOT NULL DEFAULT 0;
ALTER TABLE goals ADD COLUMN guard_started_at TEXT;
