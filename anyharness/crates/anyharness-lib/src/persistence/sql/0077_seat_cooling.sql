-- Seat rotation state (agent_auth spec §4 cell 2, "Rotation ownership"):
-- runtime-local per-seat cooling records observed from live limit errors, and
-- the last seat actually served per harness (advanced only on a successful
-- spawn, never at render/preview time).
CREATE TABLE seat_cooling (
    seat_id TEXT PRIMARY KEY,
    harness_kind TEXT NOT NULL,
    cooling_until_epoch_s INTEGER NOT NULL,
    window TEXT,
    observed_at_epoch_s INTEGER NOT NULL
);
CREATE TABLE seat_rotation (
    harness_kind TEXT PRIMARY KEY,
    last_served_seat_id TEXT NOT NULL,
    updated_at_epoch_s INTEGER NOT NULL
);
