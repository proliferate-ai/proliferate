-- Slack notifications + configuration strategy schema changes
--
-- Adds canonical notification destination fields, configuration selection
-- strategy, and session notification subscriptions.

-- ============================================
-- Automations: notification destination + strategy
-- ============================================

ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "notification_destination_type" text DEFAULT 'none';
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "notification_slack_user_id" text;
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "config_selection_strategy" text DEFAULT 'fixed';
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "fallback_configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL;
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "allowed_configuration_ids" jsonb;

-- ============================================
-- Slack installations: default session strategy
-- ============================================

ALTER TABLE "slack_installations" ADD COLUMN IF NOT EXISTS "default_config_selection_strategy" text DEFAULT 'fixed';
ALTER TABLE "slack_installations" ADD COLUMN IF NOT EXISTS "default_configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL;
ALTER TABLE "slack_installations" ADD COLUMN IF NOT EXISTS "fallback_configuration_id" uuid REFERENCES "configurations"("id") ON DELETE SET NULL;
ALTER TABLE "slack_installations" ADD COLUMN IF NOT EXISTS "allowed_configuration_ids" jsonb;

-- ============================================
-- Session notification subscriptions
-- ============================================

CREATE TABLE IF NOT EXISTS "session_notification_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "slack_installation_id" uuid NOT NULL REFERENCES "slack_installations"("id") ON DELETE CASCADE,
  "destination_type" text NOT NULL DEFAULT 'dm_user',
  "slack_user_id" text,
  "event_types" jsonb DEFAULT '["completed"]',
  "created_at" timestamptz DEFAULT now(),
  "updated_at" timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_session_notif_sub_session" ON "session_notification_subscriptions" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_session_notif_sub_user" ON "session_notification_subscriptions" ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "session_notification_subscriptions_session_user_key"
  ON "session_notification_subscriptions" ("session_id", "user_id");

-- ============================================
-- Backfill: migrate existing notification_channel_id to canonical destination
-- ============================================

UPDATE "automations"
SET "notification_destination_type" = 'slack_channel'
WHERE "notification_channel_id" IS NOT NULL
  AND "notification_destination_type" = 'none';
