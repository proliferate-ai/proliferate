-- Emulated-loop scheduler bookkeeping (session-activity-architecture §Loops,
-- runtime-emulated Codex loops). `max_fires` is the optional fire cap (NULL =
-- uncapped); `next_fire_at_ms` is the scheduler's persisted next-fire instant
-- so an armed emulated loop re-arms with the correct cadence on session
-- attach. Both are meaningful only for emulated (`native = 0`) loops; native
-- Claude crons are re-armed by the harness itself.
ALTER TABLE loops ADD COLUMN max_fires INTEGER;
ALTER TABLE loops ADD COLUMN next_fire_at_ms INTEGER;
