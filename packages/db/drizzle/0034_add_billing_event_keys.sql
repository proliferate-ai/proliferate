-- Migration: Add billing_event_keys table for global idempotency.
--
-- This table provides global uniqueness for billing event idempotency keys,
-- which is required when billing_events is converted to a partitioned table
-- (partitioned tables cannot have cross-partition unique constraints).
--
-- Stage 1 of the billing events partitioning strategy (see billing-metering.md §6.16).
-- Stage 2 (converting billing_events to a partitioned table) is a separate
-- operational procedure documented in the spec runbook.

-- 1. Create the idempotency lookup table
CREATE TABLE IF NOT EXISTS billing_event_keys (
  idempotency_key TEXT PRIMARY KEY NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Backfill from existing billing events (idempotent)
INSERT INTO billing_event_keys (idempotency_key, created_at)
SELECT idempotency_key, created_at FROM billing_events
ON CONFLICT (idempotency_key) DO NOTHING;

-- 3. Index for retention cleanup (delete old keys matching hot window)
CREATE INDEX IF NOT EXISTS idx_billing_event_keys_created_at
  ON billing_event_keys (created_at);
