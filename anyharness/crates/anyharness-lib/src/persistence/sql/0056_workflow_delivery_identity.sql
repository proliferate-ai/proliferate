-- Strict delivery identity (WS5a, feature spec §5.3). The immutable delivery
-- identity is (run_id, plan_hash, binding_hash, execution_generation). The run
-- ledger already keys on run_id; these three additive columns persist the rest
-- of the identity so a re-delivery with a CONFLICTING identity (same run_id,
-- different plan/binding hash or generation) can be rejected with a typed error.
--
-- All three are nullable: a plan/delivery produced before the server wires them
-- (WS2c) leaves them NULL, which the runtime treats as legacy mode (no identity
-- assertion) — existing runs and tests keep passing. Conflict rejection only
-- fires when a field is present on BOTH the stored run and the re-delivery and
-- the two disagree. These columns never carry a credential (spec §5.3): they are
-- the non-secret hashes and the integer generation only.
ALTER TABLE workflow_runs ADD COLUMN plan_hash TEXT;
ALTER TABLE workflow_runs ADD COLUMN binding_hash TEXT;
ALTER TABLE workflow_runs ADD COLUMN execution_generation INTEGER;
