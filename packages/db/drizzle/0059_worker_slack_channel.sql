-- Add Slack channel binding to workers table
ALTER TABLE workers ADD COLUMN slack_channel_id TEXT;
ALTER TABLE workers ADD COLUMN slack_installation_id UUID
  REFERENCES slack_installations(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_workers_slack_channel
  ON workers (slack_installation_id, slack_channel_id)
  WHERE slack_channel_id IS NOT NULL;
