"""Inbound Slack event job handling."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.slack import (
    SLACK_OUTBOUND_SOURCE_ACK,
    SLACK_OUTBOUND_SOURCE_FAILED,
    SLACK_REPO_MODE_FIXED,
)
from proliferate.db.store import cloud_agent_run_config as run_config_store
from proliferate.db.store import cloud_repo_config as repo_store
from proliferate.db.store import cloud_workspaces
from proliferate.db.store.cloud_agent_run_config import CloudAgentRunConfigRecord
from proliferate.db.store.cloud_slack import bot_configs as bot_config_store
from proliferate.db.store.cloud_slack import connections as connection_store
from proliferate.db.store.cloud_slack import outbound as outbound_store
from proliferate.db.store.cloud_slack import repo_routing_profiles as routing_profile_store
from proliferate.db.store.cloud_slack import thread_work as thread_work_store
from proliferate.db.store.cloud_slack.records import (
    SlackBotConfigRecord,
    SlackInboundEventJobRecord,
    SlackThreadWorkRecord,
    SlackWorkspaceConnectionRecord,
)
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.server.cloud.agent_run_config import service as run_config_service
from proliferate.server.cloud.agent_run_config.domain.resolve import (
    validate_config_execution_scope,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.slack.domain.mention_parse import (
    ParsedSlackMention,
    is_human_slack_message,
    parse_slack_mention_text,
)
from proliferate.server.cloud.slack.domain.message_format import (
    ack_blocks,
    clarification_blocks,
    configuration_blocks,
)
from proliferate.server.cloud.slack.domain.repo_router import (
    RepoRoutingCandidate,
    choose_repo,
)
from proliferate.server.cloud.slack.worker import commands as command_worker
from proliferate.server.cloud.slack.worker.policy import require_active_slack_bot

SLACK_CONFIGURATION_ERROR_CODES = {
    "slack_agent_run_config_invalid",
    "slack_agent_run_config_missing",
    "slack_bot_config_not_found",
    "slack_bot_disabled",
    "slack_channel_not_allowed",
    "slack_connection_reauth_required",
    "slack_connection_requires_reauth",
    "slack_fixed_repo_required",
    "slack_not_connected",
    "slack_repo_mode_invalid",
}


async def process_inbound_job(
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


async def queue_job_error(
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
    if error_code in SLACK_CONFIGURATION_ERROR_CODES:
        fallback, blocks = configuration_blocks(
            message=f"{message} ({error_code})",
            settings_url=_slack_settings_url(),
        )
    else:
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


async def _handle_app_mention(
    db: AsyncSession,
    *,
    job: SlackInboundEventJobRecord,
    event: dict[str, object],
) -> None:
    connection = await _connection_for_job(db, job)
    if not is_human_slack_message(event, bot_user_id=connection.slack_bot_user_id):
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
        fallback, blocks = configuration_blocks(
            message=(
                "I could not tell which repository to use. Set a fixed Slack repo "
                "or add `--repo owner/name`."
            ),
            settings_url=_slack_settings_url(),
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
    workspace, anyharness_workspace_id = await command_worker.create_and_materialize_workspace(
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
    session_id = await command_worker.start_session(
        db,
        organization_id=connection.organization_id,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=anyharness_workspace_id,
        session_id=f"slack-{job.id.hex[:16]}",
        agent_kind=str(run_snapshot["agent_kind"]),
        model_id=_string_or_none(run_snapshot.get("model_id")),
        mode_id=command_worker.snapshot_control(run_snapshot, "mode"),
        slack_user_id=_string_or_none(event.get("user")),
        idempotency_key=f"{job.slack_event_id}:start",
    )
    await thread_work_store.update_thread_work_session(
        db,
        thread_work_id=thread_work.id,
        cloud_session_id=session_id,
    )
    await command_worker.apply_run_config_updates(
        db,
        organization_id=connection.organization_id,
        target_id=workspace.target_id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id=anyharness_workspace_id,
        session_id=session_id,
        run_snapshot=run_snapshot,
        slack_user_id=_string_or_none(event.get("user")),
        idempotency_key_prefix=job.slack_event_id,
    )
    await command_worker.enqueue_send_prompt(
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
    if not is_human_slack_message(event, bot_user_id=connection.slack_bot_user_id):
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
    await command_worker.enqueue_send_prompt(
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
            display_name=(profiles.get(repo.id).display_name if profiles.get(repo.id) else None),
            description=(profiles.get(repo.id).description if profiles.get(repo.id) else None),
            readme_summary=(
                profiles.get(repo.id).readme_summary if profiles.get(repo.id) else None
            ),
            languages=(
                tuple(profiles.get(repo.id).languages_json or ()) if profiles.get(repo.id) else ()
            ),
            topics=(
                tuple(profiles.get(repo.id).topics_json or ()) if profiles.get(repo.id) else ()
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
        explicit = await run_config_store.get_config(db, config.default_agent_run_config_id)
        return _shared_slack_run_config_or_none(explicit, organization_id=organization_id)
    agent_kind = config.default_agent_kind or "claude"
    default = await run_config_store.get_default_config(
        db,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=organization_id,
        agent_kind=agent_kind,
    )
    return _shared_slack_run_config_or_none(default, organization_id=organization_id)


def _shared_slack_run_config_or_none(
    config: CloudAgentRunConfigRecord | None,
    *,
    organization_id: UUID,
) -> CloudAgentRunConfigRecord | None:
    if config is None:
        return None
    issue = validate_config_execution_scope(
        config,
        actor_user_id=None,
        owner_scope="organization",
        organization_id=organization_id,
        usable_in="shared_sandboxes",
    )
    return None if issue is not None else config


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


def _workspace_url(cloud_workspace_id: UUID | None) -> str | None:
    return (
        None
        if cloud_workspace_id is None or not settings.frontend_base_url
        else f"{settings.frontend_base_url.rstrip('/')}/cloud/workspaces/{cloud_workspace_id}"
    )


def _slack_settings_url() -> str | None:
    if not settings.frontend_base_url:
        return None
    return f"{settings.frontend_base_url.rstrip('/')}/settings?section=slack-bot"


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
