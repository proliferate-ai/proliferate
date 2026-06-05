"""Automation service layer."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    AUTOMATION_EXECUTION_TARGET_CLOUD,
    AUTOMATION_OWNER_SCOPE_ORGANIZATION,
    AUTOMATION_OWNER_SCOPE_PERSONAL,
    AUTOMATION_RUN_LIST_DEFAULT_LIMIT,
    AUTOMATION_TARGET_MODE_LOCAL,
    AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
    AUTOMATION_TARGET_MODE_SHARED_CLOUD,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
)
from proliferate.db.store import cloud_agent_run_config as run_config_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.automation_runs import (
    AutomationRunValue,
    create_manual_run_for_user,
    list_runs_for_automation_for_user,
)
from proliferate.db.store.automations import (
    AutomationValue,
    create_automation_for_user,
    list_automations_for_user,
    load_automation_by_id,
    update_automation_for_user,
)
from proliferate.db.store.cloud_agent_run_config import CloudAgentRunConfigRecord
from proliferate.db.store.cloud_repo_config import (
    CloudRepoConfigLimitExceededError,
    bootstrap_cloud_repo_config,
    ensure_organization_cloud_repo_config,
)
from proliferate.server.automations.domain.schedule import (
    next_future_occurrence,
)
from proliferate.server.automations.domain.validation import (
    bounded_run_list_limit,
    normalize_automation_schedule,
    normalize_repo_part,
    normalize_required_text,
    normalize_title,
)
from proliferate.server.automations.errors import (
    AutomationInvalidField,
    AutomationNotFound,
    AutomationPaused,
    AutomationRepoImmutable,
    AutomationRepoLimitExceeded,
    AutomationServiceError,
)
from proliferate.server.automations.execution import enqueue_cloud_run_execution_outbox
from proliferate.server.automations.models import (
    CreateAutomationRequest,
    UpdateAutomationRequest,
)
from proliferate.server.billing.service import (
    get_billing_snapshot_for_request,
    repo_limit_for_billing_snapshot,
)
from proliferate.server.cloud.agent_run_config.domain.resolve import (
    validate_config_execution_scope,
)
from proliferate.server.cloud.agent_run_config.service import (
    snapshot_json as agent_run_config_snapshot_json,
)
from proliferate.server.organizations.domain.policy import organization_admin_roles
from proliferate.utils.time import utcnow

_TARGET_MODES = frozenset(
    {
        AUTOMATION_TARGET_MODE_LOCAL,
        AUTOMATION_TARGET_MODE_PERSONAL_CLOUD,
        AUTOMATION_TARGET_MODE_SHARED_CLOUD,
    }
)


def _automation_invalid(
    message: str,
    *,
    code: str = "automation_invalid_field",
    status_code: int = 400,
) -> AutomationServiceError:
    return AutomationServiceError(code, message, status_code=status_code)


async def _require_org_admin(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
    )
    if membership is None:
        raise _automation_invalid(
            "Organization not found.",
            code="organization_not_found",
            status_code=404,
        )
    if membership.role not in organization_admin_roles():
        raise _automation_invalid(
            "You do not have permission to manage organization automations.",
            code="organization_permission_denied",
            status_code=403,
        )


async def _require_org_member(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=actor_user_id,
    )
    if membership is None:
        raise AutomationNotFound()


async def _load_actor_automation(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    automation_id: UUID,
    require_admin: bool,
) -> AutomationValue:
    value = await load_automation_by_id(db, automation_id=automation_id)
    if value is None:
        raise AutomationNotFound()
    if value.owner_scope == AUTOMATION_OWNER_SCOPE_PERSONAL:
        if value.owner_user_id != actor_user_id:
            raise AutomationNotFound()
        return value
    if value.organization_id is None:
        raise AutomationNotFound()
    if require_admin:
        await _require_org_admin(
            db,
            actor_user_id=actor_user_id,
            organization_id=value.organization_id,
        )
    else:
        await _require_org_member(
            db,
            actor_user_id=actor_user_id,
            organization_id=value.organization_id,
        )
    return value


def _normalize_owner_scope(value: str) -> str:
    if value not in {AUTOMATION_OWNER_SCOPE_PERSONAL, AUTOMATION_OWNER_SCOPE_ORGANIZATION}:
        raise AutomationInvalidField("ownerScope must be personal or organization.")
    return value


def _normalize_target_mode(value: str) -> str:
    if value not in _TARGET_MODES:
        raise AutomationInvalidField("targetMode must be local, personal_cloud, or shared_cloud.")
    return value


async def _validate_owner_and_target_mode(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    owner_scope: str,
    organization_id: UUID | None,
    target_mode: str,
) -> None:
    if owner_scope == AUTOMATION_OWNER_SCOPE_PERSONAL:
        if organization_id is not None:
            raise AutomationInvalidField("organizationId is only valid for team automations.")
        if target_mode == AUTOMATION_TARGET_MODE_SHARED_CLOUD:
            raise AutomationInvalidField("Personal automations cannot use shared_cloud.")
        return
    if organization_id is None:
        raise AutomationInvalidField("organizationId is required for team automations.")
    if target_mode != AUTOMATION_TARGET_MODE_SHARED_CLOUD:
        raise AutomationInvalidField("Team automations must use shared_cloud.")
    await _require_org_admin(db, actor_user_id=actor_user_id, organization_id=organization_id)


async def _load_run_config_for_owner(
    db: AsyncSession,
    *,
    actor_user_id: UUID,
    owner_scope: str,
    organization_id: UUID | None,
    target_mode: str,
    config_id: UUID,
) -> CloudAgentRunConfigRecord:
    config = await run_config_store.get_config(db, config_id)
    if config is None:
        raise _automation_invalid(
            "Agent run config not found.",
            code="agent_run_config_not_found",
            status_code=404,
        )
    issue = validate_config_execution_scope(
        config,
        actor_user_id=actor_user_id,
        owner_scope=owner_scope,
        organization_id=organization_id,
        usable_in=(
            "shared_sandboxes"
            if target_mode == AUTOMATION_TARGET_MODE_SHARED_CLOUD
            else "personal_sandboxes"
        ),
    )
    if issue is not None:
        raise _automation_invalid(
            issue.message,
            code=issue.code,
            status_code=404 if issue.code == "agent_run_config_not_found" else 400,
        )
    if config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
        assert organization_id is not None
        await _require_org_admin(db, actor_user_id=actor_user_id, organization_id=organization_id)
    elif config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM:
        return config
    return config


async def _ensure_repo_config_id(
    db: AsyncSession,
    *,
    user_id: UUID,
    owner_scope: str,
    organization_id: UUID | None,
    git_owner: str,
    git_repo_name: str,
) -> UUID:
    if owner_scope == AUTOMATION_OWNER_SCOPE_ORGANIZATION:
        if organization_id is None:
            raise AutomationInvalidField("organizationId is required for team automations.")
        repo_config = await ensure_organization_cloud_repo_config(
            db,
            organization_id=organization_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            created_by_user_id=user_id,
        )
        return repo_config.id

    # Automations point at a repo identity. Runtime-input config for that repo can still
    # be empty; the executor decides when to apply env/files/setup.
    billing_snapshot = await get_billing_snapshot_for_request(db, user_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)
    try:
        repo_config = await bootstrap_cloud_repo_config(
            db,
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            cloud_repo_limit=cloud_repo_limit,
        )
    except CloudRepoConfigLimitExceededError as error:
        raise AutomationRepoLimitExceeded(
            active_repo_count=error.active_repo_count,
            cloud_repo_limit=error.cloud_repo_limit,
        ) from error
    return repo_config.id


async def list_automations(
    db: AsyncSession,
    user_id: UUID,
    *,
    owner_scope: str = AUTOMATION_OWNER_SCOPE_PERSONAL,
    organization_id: UUID | None = None,
) -> list[AutomationValue]:
    owner_scope = _normalize_owner_scope(owner_scope)
    if owner_scope == AUTOMATION_OWNER_SCOPE_ORGANIZATION:
        if organization_id is None:
            raise AutomationInvalidField("organizationId is required for team automations.")
        await _require_org_admin(db, actor_user_id=user_id, organization_id=organization_id)
    elif organization_id is not None:
        raise AutomationInvalidField("organizationId is only valid for team automations.")
    return await list_automations_for_user(
        db,
        user_id,
        owner_scope=owner_scope,
        organization_id=organization_id,
    )


async def get_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationValue:
    return await _load_actor_automation(
        db,
        actor_user_id=user_id,
        automation_id=automation_id,
        require_admin=False,
    )


async def create_automation(
    db: AsyncSession,
    user_id: UUID,
    body: CreateAutomationRequest,
) -> AutomationValue:
    now = utcnow()
    owner_scope = _normalize_owner_scope(body.owner_scope)
    target_mode = _normalize_target_mode(body.target_mode)
    await _validate_owner_and_target_mode(
        db,
        actor_user_id=user_id,
        owner_scope=owner_scope,
        organization_id=body.organization_id,
        target_mode=target_mode,
    )
    await _load_run_config_for_owner(
        db,
        actor_user_id=user_id,
        owner_scope=owner_scope,
        organization_id=body.organization_id,
        target_mode=target_mode,
        config_id=body.cloud_agent_run_config_id,
    )
    git_owner = normalize_repo_part(body.git_owner, field_name="gitOwner")
    git_repo_name = normalize_repo_part(body.git_repo_name, field_name="gitRepoName")
    repo_config_id = await _ensure_repo_config_id(
        db,
        user_id=user_id,
        owner_scope=owner_scope,
        organization_id=body.organization_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    schedule = normalize_automation_schedule(
        rrule_text=body.schedule.rrule,
        timezone=body.schedule.timezone,
        now=now,
    )
    return await create_automation_for_user(
        db,
        user_id=user_id,
        owner_scope=owner_scope,
        organization_id=body.organization_id,
        cloud_repo_config_id=repo_config_id,
        title=normalize_title(body.title),
        prompt=normalize_required_text(body.prompt, field_name="prompt"),
        schedule_rrule=schedule.rrule_text,
        schedule_timezone=schedule.timezone,
        schedule_summary=schedule.summary,
        target_mode=target_mode,
        cloud_agent_run_config_id=body.cloud_agent_run_config_id,
        next_run_at=schedule.next_run_at,
    )


async def update_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
    body: UpdateAutomationRequest,
) -> AutomationValue:
    existing = await _load_actor_automation(
        db,
        actor_user_id=user_id,
        automation_id=automation_id,
        require_admin=True,
    )
    if "git_owner" in body.model_fields_set or "git_repo_name" in body.model_fields_set:
        raise AutomationRepoImmutable()

    updates: dict[str, object] = {}
    target_mode = existing.target_mode
    config_id = existing.cloud_agent_run_config_id
    if "target_mode" in body.model_fields_set:
        if body.target_mode is None:
            raise AutomationInvalidField("targetMode cannot be null.")
        target_mode = _normalize_target_mode(body.target_mode)
        updates["target_mode"] = target_mode
    if "cloud_agent_run_config_id" in body.model_fields_set:
        if body.cloud_agent_run_config_id is None:
            raise AutomationInvalidField("cloudAgentRunConfigId cannot be null.")
        config_id = body.cloud_agent_run_config_id
        updates["cloud_agent_run_config_id"] = config_id
    await _validate_owner_and_target_mode(
        db,
        actor_user_id=user_id,
        owner_scope=existing.owner_scope,
        organization_id=existing.organization_id,
        target_mode=target_mode,
    )
    await _load_run_config_for_owner(
        db,
        actor_user_id=user_id,
        owner_scope=existing.owner_scope,
        organization_id=existing.organization_id,
        target_mode=target_mode,
        config_id=config_id,
    )

    if "title" in body.model_fields_set:
        if body.title is None:
            raise AutomationInvalidField("title cannot be null.")
        updates["title"] = normalize_title(body.title)
    if "prompt" in body.model_fields_set:
        if body.prompt is None:
            raise AutomationInvalidField("prompt cannot be null.")
        updates["prompt"] = normalize_required_text(body.prompt, field_name="prompt")
    if "schedule" in body.model_fields_set:
        if body.schedule is None:
            raise AutomationInvalidField("schedule cannot be null.")
        schedule = normalize_automation_schedule(
            rrule_text=body.schedule.rrule,
            timezone=body.schedule.timezone,
            now=utcnow(),
        )
        updates["schedule_rrule"] = schedule.rrule_text
        updates["schedule_timezone"] = schedule.timezone
        updates["schedule_summary"] = schedule.summary
        updates["next_run_at"] = schedule.next_run_at if existing.enabled else None

    value = await update_automation_for_user(
        db,
        user_id=user_id,
        automation_id=automation_id,
        owner_scope=existing.owner_scope,
        organization_id=existing.organization_id,
        **updates,
    )
    if value is None:
        raise AutomationNotFound()
    return value


async def pause_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationValue:
    existing = await _load_actor_automation(
        db,
        actor_user_id=user_id,
        automation_id=automation_id,
        require_admin=True,
    )
    value = await update_automation_for_user(
        db,
        user_id=user_id,
        automation_id=automation_id,
        owner_scope=existing.owner_scope,
        organization_id=existing.organization_id,
        enabled=False,
        paused_at=utcnow(),
        next_run_at=None,
    )
    if value is None:
        raise AutomationNotFound()
    return value


async def resume_automation(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationValue:
    existing = await _load_actor_automation(
        db,
        actor_user_id=user_id,
        automation_id=automation_id,
        require_admin=True,
    )
    next_run_at = next_future_occurrence(
        rrule_text=existing.schedule_rrule,
        timezone=existing.schedule_timezone,
        now=utcnow(),
    )
    value = await update_automation_for_user(
        db,
        user_id=user_id,
        automation_id=automation_id,
        owner_scope=existing.owner_scope,
        organization_id=existing.organization_id,
        enabled=True,
        paused_at=None,
        next_run_at=next_run_at,
    )
    if value is None:
        raise AutomationNotFound()
    return value


async def run_automation_now(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
) -> AutomationRunValue:
    existing = await _load_actor_automation(
        db,
        actor_user_id=user_id,
        automation_id=automation_id,
        require_admin=True,
    )
    if not existing.enabled:
        raise AutomationPaused()
    await _ensure_repo_config_id(
        db,
        user_id=user_id,
        owner_scope=existing.owner_scope,
        organization_id=existing.organization_id,
        git_owner=existing.git_owner,
        git_repo_name=existing.git_repo_name,
    )
    run_config = await _load_run_config_for_owner(
        db,
        actor_user_id=user_id,
        owner_scope=existing.owner_scope,
        organization_id=existing.organization_id,
        target_mode=existing.target_mode,
        config_id=existing.cloud_agent_run_config_id,
    )
    value = await create_manual_run_for_user(
        db,
        user_id=user_id,
        automation_id=automation_id,
        owner_scope=existing.owner_scope,
        organization_id=existing.organization_id,
        agent_run_config_snapshot_json=agent_run_config_snapshot_json(run_config),
    )
    if value is None:
        raise AutomationNotFound()
    if value.execution_target == AUTOMATION_EXECUTION_TARGET_CLOUD:
        await enqueue_cloud_run_execution_outbox(db, run_id=value.id)
    return value


async def list_automation_runs(
    db: AsyncSession,
    user_id: UUID,
    automation_id: UUID,
    *,
    limit: int = AUTOMATION_RUN_LIST_DEFAULT_LIMIT,
) -> list[AutomationRunValue]:
    existing = await _load_actor_automation(
        db,
        actor_user_id=user_id,
        automation_id=automation_id,
        require_admin=False,
    )
    bounded_limit = bounded_run_list_limit(limit)
    values = await list_runs_for_automation_for_user(
        db,
        user_id=user_id,
        automation_id=automation_id,
        limit=bounded_limit,
        owner_scope=existing.owner_scope,
        organization_id=existing.organization_id,
    )
    if values is None:
        raise AutomationNotFound()
    return values
