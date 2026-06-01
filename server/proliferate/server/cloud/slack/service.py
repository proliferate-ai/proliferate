"""Application service for the Cloud Slack bot integration."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from cryptography.fernet import InvalidToken
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.config import settings
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.constants.slack import SLACK_REPO_MODE_AUTO, SLACK_REPO_MODE_FIXED
from proliferate.db.store import cloud_repo_config as repo_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.cloud_agent_run_config import configs as run_config_store
from proliferate.db.store.cloud_slack import bot_configs as bot_config_store
from proliferate.db.store.cloud_slack import connections as connection_store
from proliferate.db.store.cloud_slack import events as slack_event_store
from proliferate.db.store.cloud_slack import repo_routing_profiles as routing_profile_store
from proliferate.db.store.cloud_slack.records import (
    CloudRepoRoutingProfileRecord,
    SlackBotConfigRecord,
    SlackWorkspaceConnectionRecord,
)
from proliferate.integrations.slack import client as slack_client
from proliferate.integrations.slack.errors import SlackApiError
from proliferate.server.cloud.agent_run_config.domain.resolve import (
    validate_config_execution_scope,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.slack.domain.policy import SlackBotDenied, check_active_slack_bot
from proliferate.server.cloud.slack.models import (
    SlackBotConfigUpdateRequest,
    csv_from_string_list,
    csv_from_uuid_list,
)
from proliferate.server.cloud.slack.oauth import create_oauth_state, parse_oauth_state
from proliferate.server.cloud.slack.worker.main import defer_inbound_job_after_commit
from proliferate.utils.crypto import decrypt_text

SLACK_BOT_SCOPES = (
    "app_mentions:read,chat:write,chat:write.public,channels:history,channels:read,groups:read"
)
_SLACK_BOT_POLICY_STATUS_CODES = {
    "slack_channel_not_allowed": 403,
    "slack_not_connected": 404,
    "slack_bot_disabled": 409,
    "slack_connection_requires_reauth": 409,
}


@dataclass(frozen=True)
class SlackRepoRoutingProfileDetails:
    profile: CloudRepoRoutingProfileRecord
    git_owner: str | None
    git_repo_name: str | None


def require_active_slack_bot(
    *,
    connection: SlackWorkspaceConnectionRecord | None,
    config: SlackBotConfigRecord | None,
    slack_channel_id: str | None = None,
) -> tuple[SlackWorkspaceConnectionRecord, SlackBotConfigRecord]:
    verdict = check_active_slack_bot(
        connection=connection,
        config=config,
        slack_channel_id=slack_channel_id,
    )
    if isinstance(verdict, SlackBotDenied):
        raise CloudApiError(
            verdict.code,
            verdict.message,
            status_code=_SLACK_BOT_POLICY_STATUS_CODES[verdict.code],
        )
    assert connection is not None
    assert config is not None
    return connection, config


async def start_oauth_install(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    organization_id: UUID,
) -> str:
    await _require_org_admin(db, user_id=user.id, organization_id=organization_id)
    _require_oauth_settings()
    state = create_oauth_state(organization_id=organization_id, actor_user_id=user.id)
    return (
        "https://slack.com/oauth/v2/authorize?"
        f"client_id={settings.slack_client_id}&"
        f"scope={SLACK_BOT_SCOPES}&"
        f"redirect_uri={settings.slack_oauth_redirect_url}&"
        f"state={state}"
    )


async def complete_oauth_install(
    db: AsyncSession,
    *,
    code: str,
    state: str,
) -> UUID:
    _require_oauth_settings()
    organization_id, actor_user_id = parse_oauth_state(state)
    await _require_org_admin(db, user_id=actor_user_id, organization_id=organization_id)
    result = await slack_client.exchange_oauth_code(
        client_id=settings.slack_client_id,
        client_secret=settings.slack_client_secret,
        code=code,
        redirect_uri=settings.slack_oauth_redirect_url,
    )
    connection = await connection_store.upsert_connection(
        db,
        organization_id=organization_id,
        slack_team_id=result.team_id,
        slack_team_name=result.team_name,
        slack_bot_user_id=result.bot_user_id,
        bot_token=result.access_token,
        bot_scopes=result.scope,
        installed_by_user_id=actor_user_id,
    )
    await bot_config_store.ensure_bot_config(
        db,
        organization_id=organization_id,
        slack_workspace_connection_id=connection.id,
    )
    return organization_id


async def disconnect(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    organization_id: UUID,
) -> None:
    await _require_org_admin(db, user_id=user.id, organization_id=organization_id)
    await connection_store.revoke_connection_for_org(db, organization_id=organization_id)


async def get_bot_config_envelope(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    organization_id: UUID,
) -> tuple[SlackWorkspaceConnectionRecord | None, SlackBotConfigRecord | None]:
    await _require_org_member(db, user_id=user.id, organization_id=organization_id)
    connection = await connection_store.get_active_connection_for_org(
        db,
        organization_id=organization_id,
    )
    config = await bot_config_store.get_bot_config(db, organization_id=organization_id)
    return connection, config


async def update_bot_config(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    organization_id: UUID,
    body: SlackBotConfigUpdateRequest,
) -> SlackBotConfigRecord:
    await _require_org_admin(db, user_id=user.id, organization_id=organization_id)
    connection = await connection_store.get_active_connection_for_org(
        db,
        organization_id=organization_id,
    )
    if connection is None:
        raise CloudApiError("slack_not_connected", "Slack is not connected.", status_code=404)
    existing = await bot_config_store.get_bot_config(db, organization_id=organization_id)
    if existing is None:
        existing = await bot_config_store.ensure_bot_config(
            db,
            organization_id=organization_id,
            slack_workspace_connection_id=connection.id,
        )
    repo_mode = body.repo_mode
    if repo_mode is not None and repo_mode not in {SLACK_REPO_MODE_FIXED, SLACK_REPO_MODE_AUTO}:
        raise CloudApiError(
            "slack_repo_mode_invalid",
            "Slack repo mode is invalid.",
            status_code=400,
        )
    fixed_repo_id = body.fixed_cloud_repo_config_id
    if repo_mode == SLACK_REPO_MODE_FIXED and fixed_repo_id is None:
        fixed_repo_id = existing.fixed_cloud_repo_config_id
    if repo_mode == SLACK_REPO_MODE_FIXED and fixed_repo_id is None:
        raise CloudApiError(
            "slack_fixed_repo_required",
            "fixedCloudRepoConfigId is required for fixed repo mode.",
            status_code=400,
        )
    for repo_id in list(body.allowed_cloud_repo_config_ids or []) + (
        [fixed_repo_id] if fixed_repo_id else []
    ):
        await _require_org_repo(db, organization_id=organization_id, repo_id=repo_id)
    if body.default_agent_run_config_id is not None:
        config = await run_config_store.get_config(db, body.default_agent_run_config_id)
        issue = (
            None
            if config is None
            else validate_config_execution_scope(
                config,
                actor_user_id=None,
                owner_scope="organization",
                organization_id=organization_id,
                usable_in="shared_sandboxes",
            )
        )
        if config is None or issue is not None:
            raise CloudApiError(
                "slack_agent_run_config_invalid",
                (
                    "Default agent run config is not usable in shared sandboxes."
                    if issue is None
                    else issue.message
                ),
                status_code=400,
            )
    updated = await bot_config_store.update_bot_config(
        db,
        organization_id=organization_id,
        enabled=body.enabled,
        repo_mode=repo_mode,
        fixed_cloud_repo_config_id=fixed_repo_id,
        update_fixed_cloud_repo_config_id="fixed_cloud_repo_config_id" in body.model_fields_set,
        allowed_cloud_repo_config_ids=csv_from_uuid_list(body.allowed_cloud_repo_config_ids),
        update_allowed_cloud_repo_config_ids=body.allowed_cloud_repo_config_ids is not None,
        default_agent_kind=body.default_agent_kind,
        update_default_agent_kind="default_agent_kind" in body.model_fields_set,
        default_agent_run_config_id=body.default_agent_run_config_id,
        update_default_agent_run_config_id="default_agent_run_config_id" in body.model_fields_set,
        allowed_slack_channel_ids=csv_from_string_list(body.allowed_slack_channel_ids),
        update_allowed_slack_channel_ids=body.allowed_slack_channel_ids is not None,
        ack_message_template=body.ack_message_template,
        update_ack_message_template="ack_message_template" in body.model_fields_set,
    )
    if updated is None:
        raise CloudApiError(
            "slack_bot_config_not_found",
            "Slack bot config not found.",
            status_code=404,
        )
    return updated


async def validate_connection(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    organization_id: UUID,
) -> tuple[bool, str, str | None, str | None]:
    await _require_org_admin(db, user_id=user.id, organization_id=organization_id)
    connection = await connection_store.get_active_connection_for_org(
        db,
        organization_id=organization_id,
    )
    if connection is None:
        raise CloudApiError("slack_not_connected", "Slack is not connected.", status_code=404)
    try:
        bot_token = await _decrypt_bot_token_or_reauth(db, connection=connection)
    except CloudApiError as exc:
        return False, "reauth_required", None, exc.code
    try:
        result = await slack_client.auth_test(
            bot_token=bot_token,
        )
    except SlackApiError as exc:
        await connection_store.mark_connection_reauth_required(db, connection_id=connection.id)
        return False, "reauth_required", None, exc.code
    await connection_store.mark_connection_validated(db, connection_id=connection.id)
    return True, "active", result.team_name, None


async def list_channels(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    organization_id: UUID,
) -> list[slack_client.SlackChannelSummary]:
    await _require_org_admin(db, user_id=user.id, organization_id=organization_id)
    connection = await connection_store.get_active_connection_for_org(
        db,
        organization_id=organization_id,
    )
    if connection is None:
        raise CloudApiError("slack_not_connected", "Slack is not connected.", status_code=404)
    bot_token = await _decrypt_bot_token_or_reauth(db, connection=connection)
    return await slack_client.list_channels(
        bot_token=bot_token,
    )


async def list_repo_routing_profiles(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    organization_id: UUID,
) -> list[CloudRepoRoutingProfileRecord]:
    await _require_org_admin(db, user_id=user.id, organization_id=organization_id)
    repos = await repo_store.list_organization_cloud_repo_configs(
        db,
        organization_id=organization_id,
    )
    for repo in repos:
        if not repo.configured:
            continue
        existing = await routing_profile_store.get_profile_for_repo(
            db,
            cloud_repo_config_id=repo.id,
        )
        if existing is not None:
            continue
        await routing_profile_store.upsert_profile(
            db,
            cloud_repo_config_id=repo.id,
            organization_id=organization_id,
            display_name=f"{repo.git_owner}/{repo.git_repo_name}",
            description=None,
        )
    return await routing_profile_store.list_profiles_for_org(
        db,
        organization_id=organization_id,
    )


async def list_repo_routing_profile_details(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    organization_id: UUID,
) -> list[SlackRepoRoutingProfileDetails]:
    profiles = await list_repo_routing_profiles(db, user, organization_id=organization_id)
    repo_by_id = {
        repo.id: repo
        for repo in await repo_store.list_organization_cloud_repo_configs(
            db,
            organization_id=organization_id,
        )
    }
    return [
        SlackRepoRoutingProfileDetails(
            profile=profile,
            git_owner=repo_by_id[profile.cloud_repo_config_id].git_owner
            if profile.cloud_repo_config_id in repo_by_id
            else None,
            git_repo_name=repo_by_id[profile.cloud_repo_config_id].git_repo_name
            if profile.cloud_repo_config_id in repo_by_id
            else None,
        )
        for profile in profiles
    ]


async def upsert_repo_routing_profile(
    db: AsyncSession,
    user: ActorIdentity,
    *,
    organization_id: UUID,
    cloud_repo_config_id: UUID,
    display_name: str | None,
    description: str | None,
) -> CloudRepoRoutingProfileRecord:
    await _require_org_admin(db, user_id=user.id, organization_id=organization_id)
    await _require_org_repo(db, organization_id=organization_id, repo_id=cloud_repo_config_id)
    return await routing_profile_store.upsert_profile(
        db,
        cloud_repo_config_id=cloud_repo_config_id,
        organization_id=organization_id,
        display_name=display_name,
        description=description,
    )


async def ingest_slack_event(
    db: AsyncSession,
    *,
    payload: dict[str, object],
) -> dict[str, object]:
    if payload.get("type") == "url_verification":
        return {"challenge": str(payload.get("challenge") or "")}
    if payload.get("type") != "event_callback":
        return {"ok": True}
    event_id = _required_str(payload, "event_id")
    team_id = _string_or_none(payload.get("team_id")) or _string_or_none(payload.get("team_id"))
    connection = (
        await connection_store.get_active_connection_for_team(db, slack_team_id=team_id)
        if team_id
        else None
    )
    organization_id = connection.organization_id if connection else None
    inserted = await slack_event_store.mark_event_seen_once(
        db,
        slack_event_id=event_id,
        organization_id=organization_id,
    )
    if not inserted:
        return {"ok": True, "duplicate": True}
    event = payload.get("event")
    event_type = event.get("type") if isinstance(event, dict) else "unknown"
    job = await slack_event_store.create_inbound_job(
        db,
        slack_event_id=event_id,
        organization_id=organization_id,
        slack_team_id=team_id,
        event_type=str(event_type or "unknown"),
        payload_json=payload,
    )
    defer_inbound_job_after_commit(db, job.id)
    return {"ok": True}


async def _decrypt_bot_token_or_reauth(
    db: AsyncSession,
    *,
    connection: SlackWorkspaceConnectionRecord,
) -> str:
    try:
        return decrypt_text(connection.bot_token_ciphertext)
    except InvalidToken as exc:
        await connection_store.mark_connection_reauth_required(db, connection_id=connection.id)
        raise CloudApiError(
            "slack_connection_reauth_required",
            "Slack must be reconnected before the bot can be used.",
            status_code=409,
        ) from exc


async def _require_org_member(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user_id,
    )
    if membership is None:
        raise CloudApiError("organization_not_found", "Organization not found.", status_code=404)


async def _require_org_admin(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user_id,
    )
    if membership is None:
        raise CloudApiError("organization_not_found", "Organization not found.", status_code=404)
    if membership.role not in {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}:
        raise CloudApiError(
            "organization_permission_denied",
            "You do not have permission to manage Slack for this organization.",
            status_code=403,
        )


async def _require_org_repo(
    db: AsyncSession,
    *,
    organization_id: UUID,
    repo_id: UUID,
) -> repo_store.CloudRepoConfigValue:
    repo = await repo_store.get_cloud_repo_config_by_id(db, cloud_repo_config_id=repo_id)
    if (
        repo is None
        or repo.owner_scope != "organization"
        or repo.organization_id != organization_id
    ):
        raise CloudApiError(
            "cloud_repo_not_found",
            "Cloud repo config not found.",
            status_code=404,
        )
    return repo


def _required_str(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if isinstance(value, str) and value:
        return value
    raise CloudApiError("slack_event_invalid", f"Slack event is missing {key}.", status_code=400)


def _string_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _require_oauth_settings() -> None:
    if not settings.slack_client_id or not settings.slack_client_secret:
        raise CloudApiError(
            "slack_oauth_unconfigured",
            "Slack OAuth is not configured.",
            status_code=503,
        )
    if not settings.slack_oauth_redirect_url:
        raise CloudApiError(
            "slack_oauth_redirect_unconfigured",
            "Slack OAuth redirect URL is not configured.",
            status_code=503,
        )
