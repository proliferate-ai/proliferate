"""Application service for the Cloud Slack bot integration."""

from __future__ import annotations

import json
import re
from datetime import timedelta
from uuid import UUID

from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.cloud import (
    CloudCommandActorKind,
    CloudCommandKind,
    CloudCommandSource,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.constants.slack import (
    SLACK_OUTBOUND_SOURCE_ACK,
    SLACK_OUTBOUND_SOURCE_FAILED,
    SLACK_OUTBOUND_SOURCE_TURN,
    SLACK_REPO_MODE_AUTO,
    SLACK_REPO_MODE_FIXED,
    SLACK_THREAD_WORK_STATUS_ACTIVE,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.auth import User
from proliferate.db.store import cloud_repo_config as repo_store
from proliferate.db.store import cloud_sandbox_profiles as profile_store
from proliferate.db.store import cloud_workspaces
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.cloud_agent_run_config import configs as run_config_store
from proliferate.db.store.cloud_agent_run_config.configs import CloudAgentRunConfigRecord
from proliferate.db.store.cloud_slack import bot_configs as bot_config_store
from proliferate.db.store.cloud_slack import connections as connection_store
from proliferate.db.store.cloud_slack import events as slack_event_store
from proliferate.db.store.cloud_slack import outbound as outbound_store
from proliferate.db.store.cloud_slack import repo_routing_profiles as routing_profile_store
from proliferate.db.store.cloud_slack import thread_work as thread_work_store
from proliferate.db.store.cloud_slack.records import (
    CloudRepoRoutingProfileRecord,
    SlackBotConfigRecord,
    SlackInboundEventJobRecord,
    SlackOutboundMessageRecord,
    SlackThreadWorkRecord,
    SlackWorkspaceConnectionRecord,
)
from proliferate.db.store.cloud_sync import commands as commands_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import targets as target_store
from proliferate.integrations.slack import client as slack_client
from proliferate.integrations.slack.errors import SlackApiError
from proliferate.server.automations.worker.cloud_execution.command_models import (
    EnsureRepoCheckoutPayload,
    MaterializeWorkspacePayload,
    SendPromptPayload,
    StartSessionPayload,
)
from proliferate.server.automations.worker.cloud_execution.commands import (
    parse_materialize_workspace_result,
    parse_start_session_result,
)
from proliferate.server.automations.worker.cloud_executor_commands import (
    wait_for_command_result,
)
from proliferate.server.automations.worker.cloud_executor_config import (
    default_cloud_executor_config,
)
from proliferate.server.cloud.agent_run_config import service as run_config_service
from proliferate.server.cloud.commands.domain.rules import compact_command_json
from proliferate.server.cloud.commands.service import (
    kick_off_command_wake_after_commit_if_required,
    stamp_and_validate_command_preflight,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.slack.domain.mention_parse import (
    ParsedSlackMention,
    parse_slack_mention_text,
)
from proliferate.server.cloud.slack.domain.message_format import (
    ack_blocks,
    clarification_blocks,
    completion_blocks,
)
from proliferate.server.cloud.slack.domain.policy import require_active_slack_bot
from proliferate.server.cloud.slack.domain.repo_router import (
    RepoRoutingCandidate,
    choose_repo,
)
from proliferate.server.cloud.slack.models import (
    SlackBotConfigUpdateRequest,
    csv_from_string_list,
    csv_from_uuid_list,
)
from proliferate.server.cloud.slack.oauth import create_oauth_state, parse_oauth_state
from proliferate.server.cloud.workspaces.service import get_configured_sandbox_provider
from proliferate.utils.crypto import decrypt_text, encrypt_json
from proliferate.utils.time import utcnow

SLACK_BOT_SCOPES = (
    "app_mentions:read,chat:write,chat:write.public,"
    "channels:history,channels:read,groups:read"
)
_SYSTEM_SLACK_USER_UUID = UUID("00000000-0000-0000-0000-000000000007")
SLACK_COMMAND_WAIT_TIMEOUT = timedelta(seconds=240)


async def start_oauth_install(
    db: AsyncSession,
    user: User,
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
    user: User,
    *,
    organization_id: UUID,
) -> None:
    await _require_org_admin(db, user_id=user.id, organization_id=organization_id)
    await connection_store.revoke_connection_for_org(db, organization_id=organization_id)


async def get_bot_config_envelope(
    db: AsyncSession,
    user: User,
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
    user: User,
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
        if config is None or not config.usable_in_shared_sandboxes:
            raise CloudApiError(
                "slack_agent_run_config_invalid",
                "Default agent run config is not usable in shared sandboxes.",
                status_code=400,
            )
        if config.owner_scope == "organization" and config.organization_id != organization_id:
            raise CloudApiError(
                "slack_agent_run_config_org_mismatch",
                "Default agent run config belongs to another organization.",
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
    user: User,
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
        result = await slack_client.auth_test(
            bot_token=decrypt_text(connection.bot_token_ciphertext),
        )
    except SlackApiError as exc:
        await connection_store.mark_connection_reauth_required(db, connection_id=connection.id)
        return False, "reauth_required", None, exc.code
    await connection_store.mark_connection_validated(db, connection_id=connection.id)
    return True, "active", result.team_name, None


async def list_channels(
    db: AsyncSession,
    user: User,
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
    return await slack_client.list_channels(
        bot_token=decrypt_text(connection.bot_token_ciphertext),
    )


async def list_repo_routing_profiles(
    db: AsyncSession,
    user: User,
    *,
    organization_id: UUID,
) -> list[CloudRepoRoutingProfileRecord]:
    await _require_org_admin(db, user_id=user.id, organization_id=organization_id)
    return await routing_profile_store.list_profiles_for_org(
        db,
        organization_id=organization_id,
    )


async def upsert_repo_routing_profile(
    db: AsyncSession,
    user: User,
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
    background_tasks: BackgroundTasks,
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
    background_tasks.add_task(process_inbound_job_by_id, job.id)
    return {"ok": True}


async def process_inbound_job_by_id(job_id: UUID) -> None:
    async with db_engine.async_session_factory() as db:
        async with db.begin():
            job = await slack_event_store.mark_job_processing(db, job_id)
        if job is None:
            return
        try:
            await _process_inbound_job(db, job)
            await slack_event_store.mark_job_completed(db, job.id)
            await db.commit()
        except CloudApiError as exc:
            await db.rollback()
            await _queue_job_error(db, job, error_code=exc.code, message=exc.message)
            await slack_event_store.mark_job_failed(
                db,
                job.id,
                error_code=exc.code,
                error_message=exc.message,
            )
            await db.commit()
        except Exception as exc:
            await db.rollback()
            await _queue_job_error(db, job, error_code="slack_job_failed", message=str(exc))
            await slack_event_store.mark_job_failed(
                db,
                job.id,
                error_code="slack_job_failed",
                error_message=str(exc),
            )
            await db.commit()


async def enqueue_post_session_event(
    db: AsyncSession,
    *,
    cloud_workspace_id: UUID | None,
    session_id: str,
    event_type: str,
    event_payload: dict[str, object],
    seq: int,
) -> None:
    if cloud_workspace_id is None:
        return
    thread_work = await thread_work_store.get_thread_work_by_workspace(
        db,
        cloud_workspace_id=cloud_workspace_id,
    )
    if thread_work is None or thread_work.status != SLACK_THREAD_WORK_STATUS_ACTIVE:
        return
    connection = await connection_store.get_active_connection_for_org(
        db,
        organization_id=thread_work.organization_id,
    )
    if connection is None:
        return
    text = _post_session_text(event_type=event_type, event_payload=event_payload)
    if not text:
        return
    fallback, blocks = completion_blocks(message=text, web_url=_workspace_url(cloud_workspace_id))
    await outbound_store.enqueue_outbound_message(
        db,
        organization_id=thread_work.organization_id,
        slack_workspace_connection_id=connection.id,
        slack_team_id=thread_work.slack_team_id,
        slack_channel_id=thread_work.slack_channel_id,
        slack_thread_ts=thread_work.slack_thread_ts,
        blocks_json=blocks,
        fallback_text=fallback,
        source=SLACK_OUTBOUND_SOURCE_TURN,
        source_event_id=f"cloud-session:{session_id}:{seq}:{event_type}",
    )


async def process_due_outbound_messages(*, limit: int = 20) -> None:
    async with db_engine.async_session_factory() as db, db.begin():
        due = await outbound_store.list_due_outbound_messages(db, now=utcnow(), limit=limit)
        for message in due:
            await _send_outbound_message(db, message)


async def _process_inbound_job(
    db: AsyncSession,
    job: SlackInboundEventJobRecord,
) -> None:
    event = job.payload_json.get("event")
    if not isinstance(event, dict):
        return
    event_type = _string_or_none(event.get("type"))
    if event_type == "app_mention":
        await _handle_app_mention(db, job=job, event=event)
    elif event_type == "message" and event.get("thread_ts"):
        await _handle_thread_followup(db, job=job, event=event)


async def _handle_app_mention(
    db: AsyncSession,
    *,
    job: SlackInboundEventJobRecord,
    event: dict[str, object],
) -> None:
    connection = await _connection_for_job(db, job)
    if not _is_human_slack_message(event, bot_user_id=connection.slack_bot_user_id):
        return
    config = await bot_config_store.get_bot_config(db, organization_id=connection.organization_id)
    require_active_slack_bot(
        connection=connection,
        config=config,
        slack_channel_id=_required_str(event, "channel"),
    )
    assert config is not None
    channel_id = _required_str(event, "channel")
    message_ts = _required_str(event, "ts")
    thread_ts = _string_or_none(event.get("thread_ts")) or message_ts
    existing = await thread_work_store.get_thread_work(
        db,
        slack_team_id=connection.slack_team_id,
        slack_channel_id=channel_id,
        slack_thread_ts=thread_ts,
    )
    if existing is not None:
        await _enqueue_prompt_for_existing_thread(
            db,
            connection=connection,
            thread_work=existing,
            prompt_text=parse_slack_mention_text(
                _string_or_none(event.get("text")) or "",
                bot_user_id=connection.slack_bot_user_id,
            ).prompt,
            slack_user_id=_string_or_none(event.get("user")),
            source_event_id=job.slack_event_id,
        )
        return

    parsed = parse_slack_mention_text(
        _string_or_none(event.get("text")) or "",
        bot_user_id=connection.slack_bot_user_id,
    )
    repo = await _resolve_repo(
        db,
        organization_id=connection.organization_id,
        config=config,
        parsed=parsed,
    )
    if repo is None:
        fallback, blocks = clarification_blocks(
            message=(
                "I could not tell which repository to use. Set a fixed Slack repo "
                "or add `--repo owner/name`."
            ),
        )
        await _queue_message(
            db,
            connection=connection,
            channel_id=channel_id,
            thread_ts=thread_ts,
            fallback=fallback,
            blocks=blocks,
            source=SLACK_OUTBOUND_SOURCE_FAILED,
            source_event_id=f"{job.slack_event_id}:repo-clarification",
        )
        return
    run_config = await _resolve_run_config(
        db,
        organization_id=connection.organization_id,
        config=config,
    )
    if run_config is None:
        raise CloudApiError(
            "slack_agent_run_config_missing",
            "Slack does not have a shared agent run config.",
            status_code=409,
        )
    run_snapshot = run_config_service.snapshot_json(run_config)
    workspace, anyharness_workspace_id = await _create_and_materialize_workspace(
        db,
        organization_id=connection.organization_id,
        created_by_user_id=connection.installed_by_user_id,
        repo=repo,
        prompt=parsed.prompt,
        agent_kind=run_snapshot["agent_kind"],
        job_id=job.id,
    )
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    thread_work = await thread_work_store.create_thread_work(
        db,
        organization_id=connection.organization_id,
        slack_team_id=connection.slack_team_id,
        slack_channel_id=channel_id,
        slack_thread_ts=thread_ts,
        cloud_workspace_id=workspace.id,
        cloud_workspace_exposure_id=exposure.id if exposure else None,
        root_message_ts=message_ts,
        initial_repo_id=repo.id,
        agent_run_config_snapshot_json=run_snapshot,
    )
    fallback, blocks = ack_blocks(
        repo_label=f"{repo.git_owner}/{repo.git_repo_name}",
        web_url=_workspace_url(workspace.id),
    )
    await _queue_message(
        db,
        connection=connection,
        channel_id=channel_id,
        thread_ts=thread_ts,
        fallback=fallback,
        blocks=blocks,
        source=SLACK_OUTBOUND_SOURCE_ACK,
        source_event_id=f"{job.slack_event_id}:ack",
    )
    start_command = await _enqueue_start_session(
        db,
        organization_id=connection.organization_id,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=anyharness_workspace_id,
        session_id=f"slack-{job.id.hex[:16]}",
        agent_kind=str(run_snapshot["agent_kind"]),
        model_id=_string_or_none(run_snapshot.get("model_id")),
        mode_id=_snapshot_control(run_snapshot, "mode"),
        slack_user_id=_string_or_none(event.get("user")),
        idempotency_key=f"{job.slack_event_id}:start",
    )
    await db.commit()
    session_result = parse_start_session_result(
        await wait_for_command_result(start_command, timeout=SLACK_COMMAND_WAIT_TIMEOUT),
    )
    session_id = session_result.session_id
    await thread_work_store.update_thread_work_session(
        db,
        thread_work_id=thread_work.id,
        cloud_session_id=session_id,
    )
    await _enqueue_send_prompt(
        db,
        organization_id=connection.organization_id,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=anyharness_workspace_id,
        session_id=session_id,
        prompt_text=parsed.prompt,
        prompt_id=f"slack-event:{job.slack_event_id}",
        slack_user_id=_string_or_none(event.get("user")),
        idempotency_key=f"{job.slack_event_id}:prompt",
    )


async def _handle_thread_followup(
    db: AsyncSession,
    *,
    job: SlackInboundEventJobRecord,
    event: dict[str, object],
) -> None:
    connection = await _connection_for_job(db, job)
    if not _is_human_slack_message(event, bot_user_id=connection.slack_bot_user_id):
        return
    config = await bot_config_store.get_bot_config(db, organization_id=connection.organization_id)
    require_active_slack_bot(
        connection=connection,
        config=config,
        slack_channel_id=_required_str(event, "channel"),
    )
    thread_ts = _required_str(event, "thread_ts")
    thread_work = await thread_work_store.get_thread_work(
        db,
        slack_team_id=connection.slack_team_id,
        slack_channel_id=_required_str(event, "channel"),
        slack_thread_ts=thread_ts,
    )
    if thread_work is None:
        return
    await _enqueue_prompt_for_existing_thread(
        db,
        connection=connection,
        thread_work=thread_work,
        prompt_text=_string_or_none(event.get("text")) or "",
        slack_user_id=_string_or_none(event.get("user")),
        source_event_id=job.slack_event_id,
    )


async def _enqueue_prompt_for_existing_thread(
    db: AsyncSession,
    *,
    connection: SlackWorkspaceConnectionRecord,
    thread_work: SlackThreadWorkRecord,
    prompt_text: str,
    slack_user_id: str | None,
    source_event_id: str,
) -> None:
    if not thread_work.cloud_session_id:
        raise CloudApiError(
            "slack_thread_session_pending",
            "The Slack thread session is not ready yet.",
            status_code=409,
        )
    workspace = await cloud_workspaces.get_cloud_workspace_by_id(
        db,
        thread_work.cloud_workspace_id,
    )
    if workspace is None or not workspace.target_id:
        raise CloudApiError(
            "slack_workspace_missing",
            "Slack workspace is missing.",
            status_code=404,
        )
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
    )
    if exposure is None or not exposure.anyharness_workspace_id:
        raise CloudApiError(
            "slack_workspace_not_ready",
            "Slack workspace is not ready for prompts.",
            status_code=409,
        )
    if exposure.visibility == "claimed" or exposure.claimed_by_user_id is not None:
        fallback, blocks = clarification_blocks(
            message=(
                "This Slack workspace has been claimed in Proliferate. "
                "Continue from the claimed Proliferate session."
            ),
        )
        await _queue_message(
            db,
            connection=connection,
            channel_id=thread_work.slack_channel_id,
            thread_ts=thread_work.slack_thread_ts,
            fallback=fallback,
            blocks=blocks,
            source=SLACK_OUTBOUND_SOURCE_FAILED,
            source_event_id=f"{source_event_id}:claimed",
        )
        return
    await _enqueue_send_prompt(
        db,
        organization_id=connection.organization_id,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=exposure.anyharness_workspace_id,
        session_id=thread_work.cloud_session_id,
        prompt_text=prompt_text,
        prompt_id=f"slack-event:{source_event_id}",
        slack_user_id=slack_user_id,
        idempotency_key=f"{source_event_id}:prompt",
    )


async def _create_and_materialize_workspace(
    db: AsyncSession,
    *,
    organization_id: UUID,
    created_by_user_id: UUID,
    repo: repo_store.CloudRepoConfigValue,
    prompt: str,
    agent_kind: object,
    job_id: UUID,
) -> tuple[cloud_workspaces.CloudWorkspace, str]:
    profile = await profile_store.ensure_organization_sandbox_profile(
        db,
        organization_id=organization_id,
        created_by_user_id=created_by_user_id,
    )
    target = await target_store.ensure_primary_profile_target(
        db,
        sandbox_profile_id=profile.id,
        created_by_user_id=created_by_user_id,
    )
    branch_name = _slack_branch_name(prompt=prompt, job_id=job_id)
    repo_root_path, worktree_path = _workspace_paths(repo=repo, branch_name=branch_name)
    workspace = await cloud_workspaces.create_managed_cloud_workspace_for_profile(
        db,
        sandbox_profile_id=profile.id,
        target_id=target.id,
        created_by_user_id=created_by_user_id,
        display_name=f"Slack: {repo.git_owner}/{repo.git_repo_name}",
        git_provider="github",
        git_owner=repo.git_owner,
        git_repo_name=repo.git_repo_name,
        git_branch=branch_name,
        git_base_branch=repo.default_branch,
        worktree_path=worktree_path,
        origin_json=json.dumps(
            {
                "kind": "system",
                "entrypoint": "slack",
                "repoId": str(repo.id),
                "agentKind": str(agent_kind),
            },
            separators=(",", ":"),
            sort_keys=True,
        ),
        template_version=get_configured_sandbox_provider().template_version,
        repo_env_vars_ciphertext=encrypt_json(repo.env_vars) if repo.env_vars else None,
    )
    workspace.origin = "slack"
    workspace.updated_at = utcnow()
    await db.flush()
    await exposures_store.upsert_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=None,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
        visibility="shared_unclaimed",
        claimed_by_user_id=None,
        default_projection_level="live",
        commandable=True,
        status="active",
        origin="slack",
    )
    checkout = await _enqueue_command(
        db,
        organization_id=organization_id,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        session_id=None,
        kind=CloudCommandKind.ensure_repo_checkout.value,
        payload=EnsureRepoCheckoutPayload(
            provider="github",
            owner=repo.git_owner,
            name=repo.git_repo_name,
            path=repo_root_path,
            base_branch=repo.default_branch,
        ).to_json(),
        idempotency_scope=f"slack-workspace:{workspace.id}",
        idempotency_key="ensure-repo-checkout",
        slack_user_id=None,
    )
    await db.commit()
    await wait_for_command_result(checkout, timeout=SLACK_COMMAND_WAIT_TIMEOUT)
    root_command = await _enqueue_command(
        db,
        organization_id=organization_id,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        session_id=None,
        kind=CloudCommandKind.materialize_workspace.value,
        payload=MaterializeWorkspacePayload(
            mode="existing_path",
            path=repo_root_path,
            display_name=f"{repo.git_owner}/{repo.git_repo_name}",
            origin={"kind": "system", "entrypoint": "slack"},
            creator_context={"kind": "agent", "label": "Slack"},
        ).to_json(),
        idempotency_scope=f"slack-workspace:{workspace.id}",
        idempotency_key="materialize-root",
        slack_user_id=None,
    )
    await db.commit()
    root_result = parse_materialize_workspace_result(
        await wait_for_command_result(root_command, timeout=SLACK_COMMAND_WAIT_TIMEOUT),
    )
    worktree_command = await _enqueue_command(
        db,
        organization_id=organization_id,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        session_id=None,
        kind=CloudCommandKind.materialize_workspace.value,
        payload=MaterializeWorkspacePayload(
            mode="worktree",
            repo_root_id=root_result.repo_root_id,
            target_path=worktree_path,
            new_branch_name=branch_name,
            base_branch=repo.default_branch,
            origin={"kind": "system", "entrypoint": "slack"},
            creator_context={"kind": "agent", "label": "Slack"},
        ).to_json(),
        idempotency_scope=f"slack-workspace:{workspace.id}",
        idempotency_key="materialize-worktree",
        slack_user_id=None,
    )
    await db.commit()
    materialized = parse_materialize_workspace_result(
        await wait_for_command_result(worktree_command, timeout=SLACK_COMMAND_WAIT_TIMEOUT),
    )
    exposure = await exposures_store.get_active_workspace_exposure(
        db,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
    )
    anyharness_workspace_id = (
        exposure.anyharness_workspace_id
        if exposure and exposure.anyharness_workspace_id
        else materialized.anyharness_workspace_id
    )
    return workspace, anyharness_workspace_id


async def _enqueue_start_session(
    db: AsyncSession,
    *,
    organization_id: UUID,
    target_id: UUID,
    cloud_workspace_id: UUID,
    anyharness_workspace_id: str,
    session_id: str,
    agent_kind: str,
    model_id: str | None,
    mode_id: str | None,
    slack_user_id: str | None,
    idempotency_key: str,
) -> commands_store.CloudCommandSnapshot:
    return await _enqueue_command(
        db,
        organization_id=organization_id,
        target_id=target_id,
        cloud_workspace_id=cloud_workspace_id,
        session_id=None,
        kind=CloudCommandKind.start_session.value,
        payload=StartSessionPayload(
            workspace_id=anyharness_workspace_id,
            agent_kind=agent_kind,
            model_id=model_id,
            mode_id=mode_id,
            origin={"kind": "system", "entrypoint": "slack"},
        ).to_json(),
        idempotency_scope=f"slack-session:{session_id}",
        idempotency_key=idempotency_key,
        workspace_id=anyharness_workspace_id,
        slack_user_id=slack_user_id,
    )


async def _enqueue_send_prompt(
    db: AsyncSession,
    *,
    organization_id: UUID,
    target_id: UUID,
    cloud_workspace_id: UUID,
    anyharness_workspace_id: str,
    session_id: str,
    prompt_text: str,
    prompt_id: str,
    slack_user_id: str | None,
    idempotency_key: str,
) -> commands_store.CloudCommandSnapshot:
    return await _enqueue_command(
        db,
        organization_id=organization_id,
        target_id=target_id,
        cloud_workspace_id=cloud_workspace_id,
        session_id=session_id,
        kind=CloudCommandKind.send_prompt.value,
        payload=SendPromptPayload(text=prompt_text, prompt_id=prompt_id).to_json(),
        idempotency_scope=f"slack-session:{session_id}",
        idempotency_key=idempotency_key,
        workspace_id=anyharness_workspace_id,
        slack_user_id=slack_user_id,
    )


async def _enqueue_command(
    db: AsyncSession,
    *,
    organization_id: UUID,
    target_id: UUID,
    cloud_workspace_id: UUID | None,
    session_id: str | None,
    kind: str,
    payload: dict[str, object],
    idempotency_scope: str,
    idempotency_key: str,
    slack_user_id: str | None,
    workspace_id: str | None = None,
) -> commands_store.CloudCommandSnapshot:
    target = await target_store.get_target_by_id(db, target_id)
    if target is None:
        raise CloudApiError("cloud_target_not_found", "Cloud target not found.", status_code=404)
    payload = await stamp_and_validate_command_preflight(
        db,
        actor_user_id=_SYSTEM_SLACK_USER_UUID,
        target_id=target_id,
        kind=kind,
        payload=payload,
    )
    existing = await commands_store.get_command_by_idempotency(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
    )
    if existing is not None:
        await kick_off_command_wake_after_commit_if_required(db, target=target, command=existing)
        return existing
    command = await commands_store.create_command(
        db,
        idempotency_scope=idempotency_scope,
        idempotency_key=idempotency_key,
        target_id=target_id,
        organization_id=organization_id,
        actor_user_id=None,
        actor_kind=CloudCommandActorKind.slack.value,
        source=CloudCommandSource.slack.value,
        workspace_id=workspace_id,
        session_id=session_id,
        cloud_workspace_id=cloud_workspace_id,
        kind=kind,
        payload_json=compact_command_json(payload) or "{}",
        observed_event_seq=None,
        preconditions_json=None,
        authorization_context_json=compact_command_json(
            {
                "slackUserId": slack_user_id,
                "organizationId": str(organization_id),
                "cloudWorkspaceId": str(cloud_workspace_id) if cloud_workspace_id else None,
            }
        ),
    )
    await kick_off_command_wake_after_commit_if_required(db, target=target, command=command)
    return command


async def _resolve_repo(
    db: AsyncSession,
    *,
    organization_id: UUID,
    config: SlackBotConfigRecord,
    parsed: ParsedSlackMention,
) -> repo_store.CloudRepoConfigValue | None:
    if config.repo_mode == SLACK_REPO_MODE_FIXED and config.fixed_cloud_repo_config_id:
        return await _require_org_repo(
            db,
            organization_id=organization_id,
            repo_id=config.fixed_cloud_repo_config_id,
        )
    allowed_ids = _uuid_csv(config.allowed_cloud_repo_config_ids)
    repos = await repo_store.list_organization_cloud_repo_configs(
        db,
        organization_id=organization_id,
    )
    if allowed_ids:
        repos = [repo for repo in repos if repo.id in allowed_ids]
    profiles = {
        profile.cloud_repo_config_id: profile
        for profile in await routing_profile_store.list_profiles_for_org(
            db,
            organization_id=organization_id,
        )
    }
    candidates = tuple(
        RepoRoutingCandidate(
            cloud_repo_config_id=repo.id,
            git_owner=repo.git_owner,
            git_repo_name=repo.git_repo_name,
            display_name=(
                profiles.get(repo.id).display_name if profiles.get(repo.id) else None
            ),
            description=(
                profiles.get(repo.id).description if profiles.get(repo.id) else None
            ),
            readme_summary=(
                profiles.get(repo.id).readme_summary if profiles.get(repo.id) else None
            ),
            languages=(
                tuple(profiles.get(repo.id).languages_json or ())
                if profiles.get(repo.id)
                else ()
            ),
            topics=(
                tuple(profiles.get(repo.id).topics_json or ())
                if profiles.get(repo.id)
                else ()
            ),
        )
        for repo in repos
    )
    choice = choose_repo(
        message_text=parsed.prompt,
        repo_hint=parsed.repo_hint,
        candidates=candidates,
    )
    if choice.cloud_repo_config_id is None:
        return None
    return await repo_store.get_cloud_repo_config_by_id(
        db,
        cloud_repo_config_id=choice.cloud_repo_config_id,
    )


async def _resolve_run_config(
    db: AsyncSession,
    *,
    organization_id: UUID,
    config: SlackBotConfigRecord,
) -> CloudAgentRunConfigRecord | None:
    if config.default_agent_run_config_id is not None:
        return await run_config_store.get_config(db, config.default_agent_run_config_id)
    agent_kind = config.default_agent_kind or "claude"
    return await run_config_store.get_default_config(
        db,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
        agent_kind=agent_kind,
    )


async def _connection_for_job(
    db: AsyncSession,
    job: SlackInboundEventJobRecord,
) -> SlackWorkspaceConnectionRecord:
    if not job.slack_team_id:
        raise CloudApiError(
            "slack_team_missing",
            "Slack event is missing team id.",
            status_code=400,
        )
    connection = await connection_store.get_active_connection_for_team(
        db,
        slack_team_id=job.slack_team_id,
    )
    if connection is None:
        raise CloudApiError("slack_not_connected", "Slack is not connected.", status_code=404)
    return connection


async def _queue_job_error(
    db: AsyncSession,
    job: SlackInboundEventJobRecord,
    *,
    error_code: str,
    message: str,
) -> None:
    if not job.slack_team_id:
        return
    connection = await connection_store.get_active_connection_for_team(
        db,
        slack_team_id=job.slack_team_id,
    )
    if connection is None:
        return
    event = job.payload_json.get("event")
    if not isinstance(event, dict):
        return
    channel_id = _string_or_none(event.get("channel"))
    thread_ts = _string_or_none(event.get("thread_ts")) or _string_or_none(event.get("ts"))
    if not channel_id or not thread_ts:
        return
    fallback, blocks = clarification_blocks(message=f"{message} ({error_code})")
    await _queue_message(
        db,
        connection=connection,
        channel_id=channel_id,
        thread_ts=thread_ts,
        fallback=fallback,
        blocks=blocks,
        source=SLACK_OUTBOUND_SOURCE_FAILED,
        source_event_id=f"{job.slack_event_id}:error",
    )


async def _queue_message(
    db: AsyncSession,
    *,
    connection: SlackWorkspaceConnectionRecord,
    channel_id: str,
    thread_ts: str | None,
    fallback: str,
    blocks: list[dict[str, object]],
    source: str,
    source_event_id: str | None,
) -> None:
    await outbound_store.enqueue_outbound_message(
        db,
        organization_id=connection.organization_id,
        slack_workspace_connection_id=connection.id,
        slack_team_id=connection.slack_team_id,
        slack_channel_id=channel_id,
        slack_thread_ts=thread_ts,
        blocks_json=blocks,
        fallback_text=fallback,
        source=source,
        source_event_id=source_event_id,
    )


async def _send_outbound_message(
    db: AsyncSession,
    message: SlackOutboundMessageRecord,
) -> None:
    sending = await outbound_store.mark_outbound_sending(db, message_id=message.id)
    if sending is None or sending.status != "sending":
        return
    connection = await connection_store.get_connection(db, sending.slack_workspace_connection_id)
    if connection is None:
        await outbound_store.mark_outbound_failed(
            db,
            message_id=sending.id,
            error_code="slack_connection_missing",
            error_message="Slack connection is missing.",
        )
        return
    try:
        result = await slack_client.chat_post_message(
            bot_token=decrypt_text(connection.bot_token_ciphertext),
            channel_id=sending.slack_channel_id,
            text=sending.fallback_text,
            blocks=sending.blocks_json,
            thread_ts=sending.slack_thread_ts,
        )
    except SlackApiError as exc:
        retry_after = exc.retry_after_seconds
        attempts = sending.attempts + (0 if retry_after else 1)
        max_attempts = max(1, settings.slack_outbound_max_attempts)
        await outbound_store.mark_outbound_retry(
            db,
            message_id=sending.id,
            attempts=attempts,
            next_attempt_at=utcnow()
            + timedelta(seconds=retry_after or min(300, 2 ** min(attempts, 8))),
            error_code=exc.code,
            error_message=str(exc),
            dropped=attempts >= max_attempts,
        )
        return
    await outbound_store.mark_outbound_sent(
        db,
        message_id=sending.id,
        sent_message_ts=result.message_ts,
    )


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


def _post_session_text(*, event_type: str, event_payload: dict[str, object]) -> str | None:
    if event_type == "item_completed":
        item = event_payload.get("item")
        if isinstance(item, dict) and item.get("kind") == "assistant_message":
            return _content_text(item)[:3000] or None
    if event_type == "session_ended":
        return "Session ended."
    if event_type == "turn_ended":
        return None
    if event_type == "interaction_requested":
        return "The agent needs input. Reply in this thread to continue."
    return None


def _content_text(item: dict[str, object]) -> str:
    parts = item.get("contentParts")
    if not isinstance(parts, list):
        return ""
    texts: list[str] = []
    for part in parts:
        if (
            isinstance(part, dict)
            and part.get("type") == "text"
            and isinstance(part.get("text"), str)
        ):
            texts.append(part["text"])
    return "".join(texts).strip()


def _workspace_url(cloud_workspace_id: UUID | None) -> str | None:
    if cloud_workspace_id is None or not settings.frontend_base_url:
        return None
    return f"{settings.frontend_base_url.rstrip('/')}/cloud/workspaces/{cloud_workspace_id}"


def _slack_branch_name(*, prompt: str, job_id: UUID) -> str:
    config = default_cloud_executor_config()
    slug = re.sub(r"[^a-zA-Z0-9._-]+", "-", prompt.lower()).strip("-._")[
        : config.max_branch_slug_chars
    ]
    slug = slug or "slack"
    return f"{config.branch_prefix}/{slug}-{job_id.hex[:12]}"


def _workspace_paths(
    *,
    repo: repo_store.CloudRepoConfigValue,
    branch_name: str,
) -> tuple[str, str]:
    owner = repo.git_owner.strip().replace("/", "-")
    name = repo.git_repo_name.strip().replace("/", "-")
    repo_root_path = f"/workspace/repos/{owner}/{name}"
    worktree_path = f"/workspace/worktrees/{owner}/{name}/{branch_name.replace('/', '-')}"
    return repo_root_path, worktree_path


def _snapshot_control(snapshot: dict[str, object], key: str) -> str | None:
    controls = snapshot.get("control_values")
    if not isinstance(controls, dict):
        return None
    return _string_or_none(controls.get(key))


def _uuid_csv(value: str | None) -> set[UUID]:
    if not value:
        return set()
    result: set[UUID] = set()
    for item in value.split(","):
        try:
            result.add(UUID(item.strip()))
        except ValueError:
            continue
    return result


def _required_str(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if isinstance(value, str) and value:
        return value
    raise CloudApiError("slack_event_invalid", f"Slack event is missing {key}.", status_code=400)


def _string_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


def _is_human_slack_message(
    event: dict[str, object],
    *,
    bot_user_id: str | None,
) -> bool:
    if _string_or_none(event.get("subtype")) is not None:
        return False
    if _string_or_none(event.get("bot_id")) is not None:
        return False
    if _string_or_none(event.get("app_id")) is not None:
        return False
    user_id = _string_or_none(event.get("user"))
    return bool(user_id and user_id != bot_user_id)


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
