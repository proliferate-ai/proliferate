"""Record values returned by Slack persistence helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class SlackWorkspaceConnectionRecord:
    id: UUID
    organization_id: UUID
    slack_team_id: str
    slack_team_name: str
    slack_bot_user_id: str
    bot_token_ciphertext: str
    bot_token_ciphertext_key_id: str
    bot_scopes: str
    status: str
    installed_by_user_id: UUID
    installed_at: datetime
    last_validated_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class SlackBotConfigRecord:
    id: UUID
    organization_id: UUID
    slack_workspace_connection_id: UUID
    enabled: bool
    repo_mode: str
    fixed_cloud_repo_config_id: UUID | None
    allowed_cloud_repo_config_ids: str | None
    default_agent_kind: str | None
    default_agent_run_config_id: UUID | None
    allowed_slack_channel_ids: str | None
    ack_message_template: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True)
class SlackThreadWorkRecord:
    id: UUID
    organization_id: UUID
    slack_team_id: str
    slack_channel_id: str
    slack_thread_ts: str
    cloud_workspace_id: UUID
    cloud_session_id: str | None
    cloud_workspace_exposure_id: UUID | None
    cloud_session_projection_id: UUID | None
    root_message_ts: str
    bot_ack_message_ts: str | None
    initial_repo_id: UUID
    agent_run_config_snapshot_json: dict[str, object] | None
    status: str
    created_at: datetime
    updated_at: datetime
    archived_at: datetime | None


@dataclass(frozen=True)
class SlackInboundEventJobRecord:
    id: UUID
    slack_event_id: str
    organization_id: UUID | None
    slack_team_id: str | None
    event_type: str
    payload_json: dict[str, object]
    status: str
    attempts: int
    next_attempt_at: datetime
    last_error_code: str | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


@dataclass(frozen=True)
class SlackOutboundMessageRecord:
    id: UUID
    organization_id: UUID
    slack_workspace_connection_id: UUID
    slack_team_id: str
    slack_channel_id: str
    slack_thread_ts: str | None
    blocks_json: list[dict[str, object]]
    fallback_text: str
    source: str
    source_event_id: str | None
    status: str
    attempts: int
    next_attempt_at: datetime
    last_error_code: str | None
    last_error_message: str | None
    sent_message_ts: str | None
    created_at: datetime
    updated_at: datetime
    sent_at: datetime | None


@dataclass(frozen=True)
class CloudRepoRoutingProfileRecord:
    id: UUID
    cloud_repo_config_id: UUID
    organization_id: UUID
    display_name: str | None
    description: str | None
    readme_summary: str | None
    languages_json: list[str] | None
    topics_json: list[str] | None
    cached_at: datetime | None
    created_at: datetime
    updated_at: datetime
