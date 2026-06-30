"""Service layer for cloud secrets."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store import cloud_secrets as secret_store
from proliferate.db.store import organizations as organization_store
from proliferate.db.store.cloud_repo_config import CloudRepoConfigValue, get_cloud_repo_config
from proliferate.db.store.cloud_secrets import CloudSecretSetValue
from proliferate.db.store.cloud_sandbox_secrets import (
    CloudSandboxSecretMaterializationValue,
    load_global_secret_materialization,
    load_workspace_secret_materialization,
)
from proliferate.db.store.cloud_sandboxes import load_personal_cloud_sandbox
from proliferate.db.store.organization_records import MembershipRecord
from proliferate.db.store.repositories import (
    RepoEnvironmentValue,
    get_cloud_repo_environment,
    sync_cloud_environment_from_legacy_cloud_repo_config,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.cloud_sandboxes.materialization.service import (
    schedule_global_secret_materialization_for_organization,
    schedule_global_secret_materialization_for_user,
    schedule_workspace_secret_materialization_for_repo,
)
from proliferate.server.cloud.secrets.validation import (
    normalize_global_secret_file_path,
    normalize_secret_env_name,
    normalize_workspace_secret_file_path,
    validate_secret_value,
)


async def _load_user_global_materialization(
    db: AsyncSession,
    user_id: UUID,
) -> CloudSandboxSecretMaterializationValue | None:
    sandbox = await load_personal_cloud_sandbox(db, user_id)
    if sandbox is None:
        return None
    return await load_global_secret_materialization(db, cloud_sandbox_id=sandbox.id)


async def _load_workspace_materialization(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_environment_id: UUID,
) -> CloudSandboxSecretMaterializationValue | None:
    sandbox = await load_personal_cloud_sandbox(db, user_id)
    if sandbox is None:
        return None
    return await load_workspace_secret_materialization(
        db,
        cloud_sandbox_id=sandbox.id,
        repo_environment_id=repo_environment_id,
    )


def _secret_set_materialization_key(value: CloudSecretSetValue) -> str:
    if value.scope_kind == "personal" and value.user_id is not None:
        return f"personal:{value.user_id}"
    if value.scope_kind == "organization" and value.organization_id is not None:
        return f"organization:{value.organization_id}"
    if value.scope_kind == "workspace" and value.repo_environment_id is not None:
        return f"workspace:{value.repo_environment_id}"
    return f"{value.scope_kind}:{value.id}"


def _secret_set_has_desired_state(value: CloudSecretSetValue) -> bool:
    return value.version > 0 and (len(value.env_vars) > 0 or len(value.files) > 0)


def _materialization_ready_for_secret_set(
    value: CloudSecretSetValue,
    materialization: CloudSandboxSecretMaterializationValue | None,
) -> bool:
    return (
        materialization is not None
        and materialization.status == "ready"
        and materialization.applied_versions.get(_secret_set_materialization_key(value))
        == value.version
    )


def _should_repair_stale_materialization(
    value: CloudSecretSetValue,
    materialization: CloudSandboxSecretMaterializationValue | None,
) -> bool:
    if not _secret_set_has_desired_state(value):
        return False
    if materialization is None:
        return True
    if materialization.status == "running":
        return False
    if materialization.status == "error":
        return False
    return not _materialization_ready_for_secret_set(value, materialization)


async def _require_organization_member(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> MembershipRecord:
    membership = await organization_store.get_active_membership(
        db,
        organization_id=organization_id,
        user_id=user_id,
    )
    if membership is None:
        raise CloudApiError(
            "organization_secrets_not_found",
            "Organization secrets not found.",
            status_code=404,
        )
    return membership


async def _require_organization_admin(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> None:
    membership = await _require_organization_member(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    if membership.role not in {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN}:
        raise CloudApiError(
            "organization_secrets_permission_denied",
            "You do not have permission to manage organization secrets.",
            status_code=403,
        )


async def _load_workspace_repo_scope(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> tuple[CloudRepoConfigValue, RepoEnvironmentValue]:
    repo_config = await get_cloud_repo_config(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if repo_config is None or not repo_config.configured:
        raise CloudApiError(
            "cloud_repo_not_configured",
            "Configure this GitHub repo for cloud before managing workspace secrets.",
            status_code=404,
        )
    environment = await get_cloud_repo_environment(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    if environment is None:
        environment = await sync_cloud_environment_from_legacy_cloud_repo_config(
            db,
            cloud_repo_config_id=repo_config.id,
        )
    if environment is None or not environment.configured:
        raise CloudApiError(
            "cloud_repo_environment_not_configured",
            "Configure this GitHub repo for cloud before managing workspace secrets.",
            status_code=404,
        )
    return repo_config, environment


async def get_personal_secrets(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    value = await secret_store.get_or_create_personal_secret_set(
        db,
        user_id=user_id,
        actor_user_id=user_id,
    )
    materialization = await _load_user_global_materialization(db, user_id)
    if _should_repair_stale_materialization(value, materialization):
        schedule_global_secret_materialization_for_user(db, user_id=user_id)
    return value, materialization


async def set_personal_secret_env_var(
    db: AsyncSession,
    *,
    user_id: UUID,
    name: str,
    value: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    secret_set, _ = await get_personal_secrets(db, user_id=user_id)
    updated = await secret_store.upsert_secret_env_var(
        db,
        secret_set_id=secret_set.id,
        name=normalize_secret_env_name(name),
        value=validate_secret_value(value, field_name="Secret value"),
        actor_user_id=user_id,
    )
    schedule_global_secret_materialization_for_user(db, user_id=user_id)
    return updated, await _load_user_global_materialization(db, user_id)


async def delete_personal_secret_env_var(
    db: AsyncSession,
    *,
    user_id: UUID,
    name: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    secret_set, _ = await get_personal_secrets(db, user_id=user_id)
    updated = await secret_store.delete_secret_env_var(
        db,
        secret_set_id=secret_set.id,
        name=normalize_secret_env_name(name),
        actor_user_id=user_id,
    )
    schedule_global_secret_materialization_for_user(db, user_id=user_id)
    return updated, await _load_user_global_materialization(db, user_id)


async def set_personal_secret_file(
    db: AsyncSession,
    *,
    user_id: UUID,
    path: str,
    content: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    secret_set, _ = await get_personal_secrets(db, user_id=user_id)
    updated = await secret_store.upsert_secret_file(
        db,
        secret_set_id=secret_set.id,
        path=normalize_global_secret_file_path(path),
        content=validate_secret_value(content, field_name="Secret file content"),
        actor_user_id=user_id,
    )
    schedule_global_secret_materialization_for_user(db, user_id=user_id)
    return updated, await _load_user_global_materialization(db, user_id)


async def delete_personal_secret_file(
    db: AsyncSession,
    *,
    user_id: UUID,
    path: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    secret_set, _ = await get_personal_secrets(db, user_id=user_id)
    updated = await secret_store.delete_secret_file(
        db,
        secret_set_id=secret_set.id,
        path=normalize_global_secret_file_path(path),
        actor_user_id=user_id,
    )
    schedule_global_secret_materialization_for_user(db, user_id=user_id)
    return updated, await _load_user_global_materialization(db, user_id)


async def get_organization_secrets(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    await _require_organization_member(db, user_id=user_id, organization_id=organization_id)
    value = await secret_store.get_or_create_organization_secret_set(
        db,
        organization_id=organization_id,
        actor_user_id=user_id,
    )
    materialization = await _load_user_global_materialization(db, user_id)
    if _should_repair_stale_materialization(value, materialization):
        schedule_global_secret_materialization_for_organization(
            db,
            organization_id=organization_id,
        )
    return value, materialization


async def set_organization_secret_env_var(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    name: str,
    value: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    await _require_organization_admin(db, user_id=user_id, organization_id=organization_id)
    secret_set, _ = await get_organization_secrets(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    updated = await secret_store.upsert_secret_env_var(
        db,
        secret_set_id=secret_set.id,
        name=normalize_secret_env_name(name),
        value=validate_secret_value(value, field_name="Secret value"),
        actor_user_id=user_id,
    )
    schedule_global_secret_materialization_for_organization(
        db,
        organization_id=organization_id,
    )
    return updated, await _load_user_global_materialization(db, user_id)


async def delete_organization_secret_env_var(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    name: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    await _require_organization_admin(db, user_id=user_id, organization_id=organization_id)
    secret_set, _ = await get_organization_secrets(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    updated = await secret_store.delete_secret_env_var(
        db,
        secret_set_id=secret_set.id,
        name=normalize_secret_env_name(name),
        actor_user_id=user_id,
    )
    schedule_global_secret_materialization_for_organization(
        db,
        organization_id=organization_id,
    )
    return updated, await _load_user_global_materialization(db, user_id)


async def set_organization_secret_file(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    path: str,
    content: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    await _require_organization_admin(db, user_id=user_id, organization_id=organization_id)
    secret_set, _ = await get_organization_secrets(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    updated = await secret_store.upsert_secret_file(
        db,
        secret_set_id=secret_set.id,
        path=normalize_global_secret_file_path(path),
        content=validate_secret_value(content, field_name="Secret file content"),
        actor_user_id=user_id,
    )
    schedule_global_secret_materialization_for_organization(
        db,
        organization_id=organization_id,
    )
    return updated, await _load_user_global_materialization(db, user_id)


async def delete_organization_secret_file(
    db: AsyncSession,
    *,
    user_id: UUID,
    organization_id: UUID,
    path: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    await _require_organization_admin(db, user_id=user_id, organization_id=organization_id)
    secret_set, _ = await get_organization_secrets(
        db,
        user_id=user_id,
        organization_id=organization_id,
    )
    updated = await secret_store.delete_secret_file(
        db,
        secret_set_id=secret_set.id,
        path=normalize_global_secret_file_path(path),
        actor_user_id=user_id,
    )
    schedule_global_secret_materialization_for_organization(
        db,
        organization_id=organization_id,
    )
    return updated, await _load_user_global_materialization(db, user_id)


async def get_workspace_secrets(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    repo_config, environment = await _load_workspace_repo_scope(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    value = await secret_store.get_or_create_workspace_secret_set(
        db,
        repo_environment_id=environment.id,
        actor_user_id=user_id,
    )
    materialization = await _load_workspace_materialization(
        db,
        user_id=user_id,
        repo_environment_id=environment.id,
    )
    if _should_repair_stale_materialization(value, materialization):
        schedule_workspace_secret_materialization_for_repo(
            db,
            user_id=user_id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
    return value, materialization


async def set_workspace_secret_env_var(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    name: str,
    value: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    repo_config, environment = await _load_workspace_repo_scope(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    secret_set = await secret_store.get_or_create_workspace_secret_set(
        db,
        repo_environment_id=environment.id,
        actor_user_id=user_id,
    )
    updated = await secret_store.upsert_secret_env_var(
        db,
        secret_set_id=secret_set.id,
        name=normalize_secret_env_name(name),
        value=validate_secret_value(value, field_name="Secret value"),
        actor_user_id=user_id,
    )
    schedule_workspace_secret_materialization_for_repo(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    return updated, await _load_workspace_materialization(
        db,
        user_id=user_id,
        repo_environment_id=environment.id,
    )


async def delete_workspace_secret_env_var(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    name: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    repo_config, environment = await _load_workspace_repo_scope(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    secret_set = await secret_store.get_or_create_workspace_secret_set(
        db,
        repo_environment_id=environment.id,
        actor_user_id=user_id,
    )
    updated = await secret_store.delete_secret_env_var(
        db,
        secret_set_id=secret_set.id,
        name=normalize_secret_env_name(name),
        actor_user_id=user_id,
    )
    schedule_workspace_secret_materialization_for_repo(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    return updated, await _load_workspace_materialization(
        db,
        user_id=user_id,
        repo_environment_id=environment.id,
    )


async def set_workspace_secret_file(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    path: str,
    content: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    repo_config, environment = await _load_workspace_repo_scope(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    secret_set = await secret_store.get_or_create_workspace_secret_set(
        db,
        repo_environment_id=environment.id,
        actor_user_id=user_id,
    )
    updated = await secret_store.upsert_secret_file(
        db,
        secret_set_id=secret_set.id,
        path=normalize_workspace_secret_file_path(path),
        content=validate_secret_value(content, field_name="Secret file content"),
        actor_user_id=user_id,
    )
    schedule_workspace_secret_materialization_for_repo(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    return updated, await _load_workspace_materialization(
        db,
        user_id=user_id,
        repo_environment_id=environment.id,
    )


async def delete_workspace_secret_file(
    db: AsyncSession,
    *,
    user_id: UUID,
    git_owner: str,
    git_repo_name: str,
    path: str,
) -> tuple[CloudSecretSetValue, CloudSandboxSecretMaterializationValue | None]:
    repo_config, environment = await _load_workspace_repo_scope(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    secret_set = await secret_store.get_or_create_workspace_secret_set(
        db,
        repo_environment_id=environment.id,
        actor_user_id=user_id,
    )
    updated = await secret_store.delete_secret_file(
        db,
        secret_set_id=secret_set.id,
        path=normalize_workspace_secret_file_path(path),
        actor_user_id=user_id,
    )
    schedule_workspace_secret_materialization_for_repo(
        db,
        user_id=user_id,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
    )
    return updated, await _load_workspace_materialization(
        db,
        user_id=user_id,
        repo_environment_id=environment.id,
    )
