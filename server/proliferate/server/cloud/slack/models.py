"""Request/response models for the Cloud Slack bot API."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.db.store.cloud_slack.records import (
    CloudRepoRoutingProfileRecord,
    SlackBotConfigRecord,
    SlackWorkspaceConnectionRecord,
)


class SlackBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class SlackConnectionResponse(SlackBaseModel):
    id: str
    organization_id: str = Field(alias="organizationId")
    slack_team_id: str = Field(alias="slackTeamId")
    slack_team_name: str = Field(alias="slackTeamName")
    slack_bot_user_id: str = Field(alias="slackBotUserId")
    bot_scopes: str = Field(alias="botScopes")
    status: str
    installed_by_user_id: str = Field(alias="installedByUserId")
    installed_at: str = Field(alias="installedAt")
    last_validated_at: str | None = Field(alias="lastValidatedAt")
    revoked_at: str | None = Field(alias="revokedAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class SlackBotConfigResponse(SlackBaseModel):
    id: str
    organization_id: str = Field(alias="organizationId")
    slack_workspace_connection_id: str = Field(alias="slackWorkspaceConnectionId")
    enabled: bool
    repo_mode: str = Field(alias="repoMode")
    fixed_cloud_repo_config_id: str | None = Field(alias="fixedCloudRepoConfigId")
    allowed_cloud_repo_config_ids: list[str] = Field(alias="allowedCloudRepoConfigIds")
    default_agent_kind: str | None = Field(alias="defaultAgentKind")
    default_agent_run_config_id: str | None = Field(alias="defaultAgentRunConfigId")
    allowed_slack_channel_ids: list[str] = Field(alias="allowedSlackChannelIds")
    ack_message_template: str | None = Field(alias="ackMessageTemplate")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class SlackBotConfigEnvelopeResponse(SlackBaseModel):
    connection: SlackConnectionResponse | None
    config: SlackBotConfigResponse | None


class SlackBotConfigUpdateRequest(SlackBaseModel):
    enabled: bool | None = None
    repo_mode: str | None = Field(default=None, alias="repoMode")
    fixed_cloud_repo_config_id: UUID | None = Field(default=None, alias="fixedCloudRepoConfigId")
    allowed_cloud_repo_config_ids: list[UUID] | None = Field(
        default=None,
        alias="allowedCloudRepoConfigIds",
    )
    default_agent_kind: str | None = Field(default=None, alias="defaultAgentKind")
    default_agent_run_config_id: UUID | None = Field(default=None, alias="defaultAgentRunConfigId")
    allowed_slack_channel_ids: list[str] | None = Field(
        default=None,
        alias="allowedSlackChannelIds",
    )
    ack_message_template: str | None = Field(default=None, alias="ackMessageTemplate")


class SlackOAuthStartResponse(SlackBaseModel):
    authorize_url: str = Field(alias="authorizeUrl")


class SlackValidateConnectionResponse(SlackBaseModel):
    ok: bool
    status: str
    team_name: str | None = Field(default=None, alias="teamName")
    error_code: str | None = Field(default=None, alias="errorCode")


class SlackChannelResponse(SlackBaseModel):
    id: str
    name: str
    is_private: bool = Field(alias="isPrivate")
    is_archived: bool = Field(alias="isArchived")


class SlackChannelsResponse(SlackBaseModel):
    channels: list[SlackChannelResponse]


class SlackRepoRoutingProfileResponse(SlackBaseModel):
    id: str
    cloud_repo_config_id: str = Field(alias="cloudRepoConfigId")
    organization_id: str = Field(alias="organizationId")
    display_name: str | None = Field(alias="displayName")
    description: str | None = None
    readme_summary: str | None = Field(alias="readmeSummary")
    languages: list[str]
    topics: list[str]
    cached_at: str | None = Field(alias="cachedAt")
    created_at: str = Field(alias="createdAt")
    updated_at: str = Field(alias="updatedAt")


class SlackRepoRoutingProfilesResponse(SlackBaseModel):
    profiles: list[SlackRepoRoutingProfileResponse]


class SlackRepoRoutingProfileUpsertRequest(SlackBaseModel):
    cloud_repo_config_id: UUID = Field(alias="cloudRepoConfigId")
    display_name: str | None = Field(default=None, alias="displayName")
    description: str | None = None


class SlackEventsResponse(SlackBaseModel):
    ok: bool = True


def connection_payload(
    value: SlackWorkspaceConnectionRecord | None,
) -> SlackConnectionResponse | None:
    if value is None:
        return None
    return SlackConnectionResponse(
        id=str(value.id),
        organization_id=str(value.organization_id),
        slack_team_id=value.slack_team_id,
        slack_team_name=value.slack_team_name,
        slack_bot_user_id=value.slack_bot_user_id,
        bot_scopes=value.bot_scopes,
        status=value.status,
        installed_by_user_id=str(value.installed_by_user_id),
        installed_at=_iso(value.installed_at),
        last_validated_at=_iso_or_none(value.last_validated_at),
        revoked_at=_iso_or_none(value.revoked_at),
        created_at=_iso(value.created_at),
        updated_at=_iso(value.updated_at),
    )


def bot_config_payload(value: SlackBotConfigRecord | None) -> SlackBotConfigResponse | None:
    if value is None:
        return None
    return SlackBotConfigResponse(
        id=str(value.id),
        organization_id=str(value.organization_id),
        slack_workspace_connection_id=str(value.slack_workspace_connection_id),
        enabled=value.enabled,
        repo_mode=value.repo_mode,
        fixed_cloud_repo_config_id=(
            str(value.fixed_cloud_repo_config_id) if value.fixed_cloud_repo_config_id else None
        ),
        allowed_cloud_repo_config_ids=_split_csv(value.allowed_cloud_repo_config_ids),
        default_agent_kind=value.default_agent_kind,
        default_agent_run_config_id=(
            str(value.default_agent_run_config_id) if value.default_agent_run_config_id else None
        ),
        allowed_slack_channel_ids=_split_csv(value.allowed_slack_channel_ids),
        ack_message_template=value.ack_message_template,
        created_at=_iso(value.created_at),
        updated_at=_iso(value.updated_at),
    )


def repo_routing_profile_payload(
    value: CloudRepoRoutingProfileRecord,
) -> SlackRepoRoutingProfileResponse:
    return SlackRepoRoutingProfileResponse(
        id=str(value.id),
        cloud_repo_config_id=str(value.cloud_repo_config_id),
        organization_id=str(value.organization_id),
        display_name=value.display_name,
        description=value.description,
        readme_summary=value.readme_summary,
        languages=list(value.languages_json or []),
        topics=list(value.topics_json or []),
        cached_at=_iso_or_none(value.cached_at),
        created_at=_iso(value.created_at),
        updated_at=_iso(value.updated_at),
    )


def csv_from_uuid_list(values: list[UUID] | None) -> str | None:
    if values is None:
        return None
    return ",".join(str(value) for value in values)


def csv_from_string_list(values: list[str] | None) -> str | None:
    if values is None:
        return None
    return ",".join(value.strip() for value in values if value.strip())


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _iso(value: datetime) -> str:
    return value.isoformat()


def _iso_or_none(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()
