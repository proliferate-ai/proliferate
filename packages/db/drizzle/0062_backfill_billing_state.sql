-- Backfill legacy billing_state values to canonical states.
-- "unconfigured" and "trial" are no longer valid; map them to "free".
UPDATE organization SET billing_state = 'free' WHERE billing_state IN ('unconfigured', 'trial');

-- Update the default to match the new canonical enum.
ALTER TABLE organization ALTER COLUMN billing_state SET DEFAULT 'free';
