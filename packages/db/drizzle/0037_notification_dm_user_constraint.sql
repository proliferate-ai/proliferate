-- Ensure slack_user_id is present when destination type is dm_user
ALTER TABLE "automations"
  ADD CONSTRAINT "chk_automations_dm_user_slack_id"
  CHECK (
    notification_destination_type != 'slack_dm_user'
    OR notification_slack_user_id IS NOT NULL
  );

ALTER TABLE "session_notification_subscriptions"
  ADD CONSTRAINT "chk_session_notif_sub_dm_user_slack_id"
  CHECK (
    destination_type != 'dm_user'
    OR slack_user_id IS NOT NULL
  );
