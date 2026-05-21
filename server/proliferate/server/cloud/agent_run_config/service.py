"""Cloud agent run config service layer."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.automations import (
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL,
    CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM,
    CLOUD_AGENT_RUN_CONFIG_STATUS_ACTIVE,
)
from proliferate.db.models.auth import User
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.cloud_agent_run_config import configs as config_store
from proliferate.db.store.cloud_agent_run_config.configs import (
    CloudAgentRunConfigDefaultRecord,
    CloudAgentRunConfigRecord,
)
from proliferate.server.catalogs.service import read_agent_catalog
from proliferate.server.cloud.agent_run_config.domain.resolve import (
    AgentRunConfigIssue,
    ResolvedAgentRunConfig,
    resolve_runtime_values,
    validate_config_values,
)
from proliferate.server.cloud.agent_run_config.models import (
    AgentRunConfigCreateRequest,
    AgentRunConfigUpdateRequest,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.organizations.domain.policy import organization_admin_roles


def _clean_required_text(value: str, *, field_name: str, max_length: int = 255) -> str:
    cleaned = value.strip()
    if not cleaned:
        raise CloudApiError(
            "invalid_agent_run_config",
            f"{field_name} is required.",
            status_code=400,
        )
    if len(cleaned) > max_length:
        raise CloudApiError(
            "invalid_agent_run_config",
            f"{field_name} must be at most {max_length} characters.",
            status_code=400,
        )
    return cleaned


def _raise_issue(issue: AgentRunConfigIssue | None) -> None:
    if issue is not None:
        raise CloudApiError(issue.code, issue.message, status_code=400)


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
    if membership.role not in organization_admin_roles():
        raise CloudApiError(
            "organization_permission_denied",
            "You do not have permission to manage organization agent run configs.",
            status_code=403,
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


async def _visible_config(
    db: AsyncSession,
    *,
    user: User,
    config_id: UUID,
) -> CloudAgentRunConfigRecord:
    value = await config_store.get_config(db, config_id)
    if value is None:
        raise CloudApiError(
            "agent_run_config_not_found",
            "Agent run config not found.",
            status_code=404,
        )
    if value.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL:
        if value.owner_user_id != user.id:
            raise CloudApiError(
                "agent_run_config_not_found",
                "Agent run config not found.",
                status_code=404,
            )
    elif value.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
        if value.organization_id is None:
            raise CloudApiError(
                "agent_run_config_not_found",
                "Agent run config not found.",
                status_code=404,
            )
        await _require_org_member(db, user_id=user.id, organization_id=value.organization_id)
    return value


def resolved_snapshot(value: CloudAgentRunConfigRecord) -> ResolvedAgentRunConfig | None:
    resolved = resolve_runtime_values(read_agent_catalog().catalog, value)
    return resolved if isinstance(resolved, ResolvedAgentRunConfig) else None


def snapshot_json(value: CloudAgentRunConfigRecord) -> dict[str, object]:
    resolved = resolve_runtime_values(read_agent_catalog().catalog, value)
    if isinstance(resolved, AgentRunConfigIssue):
        raise CloudApiError(resolved.code, resolved.message, status_code=400)
    return {
        "config_id": resolved.config_id,
        "config_name": resolved.config_name,
        "agent_kind": resolved.agent_kind,
        "model_id": resolved.model_id,
        "control_values": resolved.control_values,
        "ignored_keys": list(resolved.ignored_keys),
        "owner_scope_at_snapshot": value.owner_scope,
    }


async def list_agent_run_configs(
    db: AsyncSession,
    user: User,
    *,
    owner_scope: str | None = None,
    organization_id: UUID | None = None,
    agent_kind: str | None = None,
    usable_in: str | None = None,
    status: str | None = CLOUD_AGENT_RUN_CONFIG_STATUS_ACTIVE,
) -> list[CloudAgentRunConfigRecord]:
    if owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
        if organization_id is None:
            raise CloudApiError(
                "organization_required",
                "organizationId is required for organization configs.",
                status_code=400,
            )
        await _require_org_member(db, user_id=user.id, organization_id=organization_id)
    return list(
        await config_store.list_configs(
            db,
            actor_user_id=user.id,
            organization_id=organization_id,
            owner_scope=owner_scope,
            agent_kind=agent_kind,
            usable_in=usable_in,
            status=status,
        )
    )


async def create_agent_run_config(
    db: AsyncSession,
    user: User,
    body: AgentRunConfigCreateRequest,
) -> CloudAgentRunConfigRecord:
    owner_scope = body.owner_scope
    if owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM:
        raise CloudApiError(
            "system_agent_run_config_read_only",
            "System agent run configs are seeded by deployment.",
            status_code=403,
        )
    owner_user_id: UUID | None = user.id
    organization_id: UUID | None = None
    if owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
        if body.organization_id is None:
            raise CloudApiError(
                "organization_required",
                "organizationId is required for organization configs.",
                status_code=400,
            )
        await _require_org_admin(db, user_id=user.id, organization_id=body.organization_id)
        owner_user_id = None
        organization_id = body.organization_id
    elif body.organization_id is not None:
        raise CloudApiError(
            "invalid_owner_scope",
            "organizationId is only valid for organization configs.",
            status_code=400,
        )
    name = _clean_required_text(body.name, field_name="name")
    agent_kind = _clean_required_text(body.agent_kind, field_name="agentKind", max_length=32)
    model_id = _clean_required_text(body.model_id, field_name="modelId")
    _raise_issue(
        validate_config_values(
            read_agent_catalog().catalog,
            agent_kind=agent_kind,
            model_id=model_id,
            control_values=body.control_values,
        )
    )
    return await config_store.create_config(
        db,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        created_by_user_id=user.id,
        name=name,
        agent_kind=agent_kind,
        model_id=model_id,
        control_values_json=body.control_values,
        usable_in_personal_sandboxes=body.usable_in_personal_sandboxes,
        usable_in_shared_sandboxes=body.usable_in_shared_sandboxes,
    )


async def get_agent_run_config(
    db: AsyncSession,
    user: User,
    config_id: UUID,
) -> CloudAgentRunConfigRecord:
    return await _visible_config(db, user=user, config_id=config_id)


async def update_agent_run_config(
    db: AsyncSession,
    user: User,
    config_id: UUID,
    body: AgentRunConfigUpdateRequest,
) -> CloudAgentRunConfigRecord:
    existing = await _visible_config(db, user=user, config_id=config_id)
    if existing.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM:
        raise CloudApiError(
            "system_agent_run_config_read_only",
            "System agent run configs are seeded by deployment.",
            status_code=403,
        )
    if existing.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
        assert existing.organization_id is not None
        await _require_org_admin(db, user_id=user.id, organization_id=existing.organization_id)

    name = _clean_required_text(body.name, field_name="name") if body.name is not None else None
    model_id = (
        _clean_required_text(body.model_id, field_name="modelId")
        if body.model_id is not None
        else existing.model_id
    )
    control_values = (
        body.control_values if body.control_values is not None else existing.control_values_json
    )
    _raise_issue(
        validate_config_values(
            read_agent_catalog().catalog,
            agent_kind=existing.agent_kind,
            model_id=model_id,
            control_values=control_values,
        )
    )
    updated = await config_store.update_config(
        db,
        config_id=config_id,
        name=name,
        model_id=model_id if body.model_id is not None else None,
        control_values_json=body.control_values,
        usable_in_personal_sandboxes=body.usable_in_personal_sandboxes,
        usable_in_shared_sandboxes=body.usable_in_shared_sandboxes,
    )
    if updated is None:
        raise CloudApiError(
            "agent_run_config_not_found",
            "Agent run config not found.",
            status_code=404,
        )
    return updated


async def archive_agent_run_config(
    db: AsyncSession,
    user: User,
    config_id: UUID,
) -> CloudAgentRunConfigRecord:
    existing = await _visible_config(db, user=user, config_id=config_id)
    if existing.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_SYSTEM:
        raise CloudApiError(
            "system_agent_run_config_read_only",
            "System agent run configs are seeded by deployment.",
            status_code=403,
        )
    if existing.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
        assert existing.organization_id is not None
        await _require_org_admin(db, user_id=user.id, organization_id=existing.organization_id)
    archived = await config_store.archive_config(db, config_id)
    if archived is None:
        raise CloudApiError(
            "agent_run_config_not_found",
            "Agent run config not found.",
            status_code=404,
        )
    return archived


async def list_agent_run_config_defaults(
    db: AsyncSession,
    user: User,
    *,
    owner_scope: str,
    organization_id: UUID | None,
) -> list[CloudAgentRunConfigDefaultRecord]:
    owner_user_id: UUID | None = user.id
    if owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
        if organization_id is None:
            raise CloudApiError(
                "organization_required",
                "organizationId is required.",
                status_code=400,
            )
        await _require_org_member(db, user_id=user.id, organization_id=organization_id)
        owner_user_id = None
    elif owner_scope != CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL:
        raise CloudApiError("invalid_owner_scope", "Invalid owner scope.", status_code=400)
    return list(
        await config_store.list_defaults(
            db,
            owner_scope=owner_scope,
            owner_user_id=owner_user_id,
            organization_id=organization_id,
        )
    )


async def set_agent_run_config_default(
    db: AsyncSession,
    user: User,
    *,
    owner_scope: str,
    organization_id: UUID | None,
    agent_kind: str,
    config_id: UUID,
) -> CloudAgentRunConfigDefaultRecord:
    config = await _visible_config(db, user=user, config_id=config_id)
    if config.agent_kind != agent_kind:
        raise CloudApiError(
            "agent_run_config_kind_mismatch",
            "Config agent kind does not match the default slot.",
            400,
        )
    owner_user_id: UUID | None = user.id
    if owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL:
        if not config.usable_in_personal_sandboxes:
            raise CloudApiError(
                "agent_run_config_not_usable",
                "Config cannot be used in personal sandboxes.",
                400,
            )
        if config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
            raise CloudApiError(
                "agent_run_config_not_usable",
                "Organization configs cannot be pinned as personal defaults.",
                400,
            )
        organization_id = None
    elif owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_ORGANIZATION:
        if organization_id is None:
            raise CloudApiError(
                "organization_required",
                "organizationId is required.",
                status_code=400,
            )
        await _require_org_admin(db, user_id=user.id, organization_id=organization_id)
        if not config.usable_in_shared_sandboxes:
            raise CloudApiError(
                "agent_run_config_not_usable",
                "Config cannot be used in shared sandboxes.",
                400,
            )
        if config.owner_scope == CLOUD_AGENT_RUN_CONFIG_OWNER_SCOPE_PERSONAL:
            raise CloudApiError(
                "agent_run_config_not_usable",
                "Personal configs cannot be pinned as organization defaults.",
                400,
            )
        owner_user_id = None
    else:
        raise CloudApiError("invalid_owner_scope", "Invalid owner scope.", status_code=400)

    return await config_store.upsert_default(
        db,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        agent_kind=agent_kind,
        config_id=config_id,
        created_by_user_id=user.id,
    )


async def resolve_default_agent_run_config(
    db: AsyncSession,
    *,
    owner_scope: str,
    owner_user_id: UUID | None,
    organization_id: UUID | None,
    agent_kind: str,
) -> CloudAgentRunConfigRecord:
    value = await config_store.get_default_config(
        db,
        owner_scope=owner_scope,
        owner_user_id=owner_user_id,
        organization_id=organization_id,
        agent_kind=agent_kind,
    )
    if value is None:
        raise CloudApiError(
            "agent_run_config_missing_default",
            "No default agent run config is available.",
            status_code=409,
        )
    return value
