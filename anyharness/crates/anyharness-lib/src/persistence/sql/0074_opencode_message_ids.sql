-- Forks Lane C (OpenCode targeted-fork side-door): maps our runtime-generated
-- (turn_id, item_id) user-message identity to the vendor OpenCode message id
-- observed on the ACP wire (session/update user_message_chunk `messageId`).
--
-- The vendor id is required to dispatch a targeted `POST /session/{id}/fork`
-- side-door call: upstream Session.fork does a raw string comparison against
-- message ids with no existence check, so dispatching on anything but a
-- vendor-confirmed id risks a silent full-copy or near-empty fork. This table
-- is the only place that translation happens.
--
-- First-writer-wins: a session/turn/item is captured once, on the first
-- observed echo, and never overwritten by a later replay of the same chunk.
CREATE TABLE opencode_message_ids (
    session_id TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    vendor_message_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, turn_id, item_id)
);
