"""Provisioning input loading for cloud runtime startup."""

from __future__ import annotations

from uuid import UUID

from proliferate.auth.identity.store import get_ready_github_grant_for_user
from proliferate.db import engine as db_engine
from proliferate.db.store.cloud_runtime_environments import (
    attach_target_to_runtime_environment,
    ensure_runtime_environment_for_workspace_id,
    save_runtime_environment_state,
)
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.db.store.cloud_workspaces import get_cloud_workspace_by_id
from proliferate.db.store.users import load_user_with_oauth_accounts_by_id
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.runtime.models import CloudProvisionInput
from proliferate.server.cloud.runtime.provisioning.data_key import generate_anyharness_data_key
from proliferate.utils.crypto import decrypt_text, encrypt_text
from proliferate.utils.time import utcnow


def _normalize_identity_value(value: object | None) -> str | None:
    if isinstance(value, str):
        trimmed = value.strip()
        if trimmed:
            return trimmed
    return None


def resolve_git_identity(user: object, github_account: object | None) -> tuple[str, str]:
    git_user_email = _normalize_identity_value(getattr(github_account, "account_email", None))
    if git_user_email is None:
        git_user_email = _normalize_identity_value(getattr(user, "email", None))
    if git_user_email is None:
        raise CloudApiError(
            "git_identity_required",
            "A usable email address is required to configure cloud git commits.",
            status_code=400,
        )

    git_user_name = _normalize_identity_value(getattr(user, "display_name", None))
    if git_user_name is None:
        git_user_name = git_user_email.partition("@")[0].strip() or "Proliferate User"

    return git_user_name, git_user_email


async def load_provision_input(
    workspace_id: UUID,
    *,
    requested_base_sha: str | None = None,
) -> CloudProvisionInput | None:
    async with db_engine.async_session_factory() as db:
        workspace = await get_cloud_workspace_by_id(db, workspace_id)
    if workspace is None:
        return None

    async with db_engine.async_session_factory() as db, db.begin():
        runtime_environment = await ensure_runtime_environment_for_workspace_id(db, workspace_id)
        if runtime_environment and not runtime_environment.anyharness_data_key_ciphertext:
            runtime_environment = await save_runtime_environment_state(
                db,
                runtime_environment.id,
                anyharness_data_key_ciphertext=encrypt_text(generate_anyharness_data_key()),
            )
    if runtime_environment is None:
        return None
    anyharness_data_key_ciphertext = runtime_environment.anyharness_data_key_ciphertext
    if anyharness_data_key_ciphertext is None:
        raise CloudApiError(
            "runtime_data_key_required",
            "Cloud runtime data key could not be prepared.",
            status_code=500,
        )

    async with db_engine.async_session_factory() as db:
        user = await load_user_with_oauth_accounts_by_id(db, workspace.user_id)
        github_grant = await get_ready_github_grant_for_user(db, user_id=workspace.user_id)
    if user is None:
        return None
    if github_grant is None:
        raise CloudApiError(
            "github_link_required",
            "Linked GitHub account is missing an access token.",
            status_code=400,
        )
    git_user_name, git_user_email = resolve_git_identity(user, github_grant)

    async with db_engine.async_session_factory() as db, db.begin():
        if workspace.sandbox_profile_id is None or workspace.target_id is None:
            raise CloudApiError(
                "cloud_target_not_found",
                "Cloud workspace is missing its sandbox profile or target.",
                status_code=409,
            )
        target = await targets_store.get_target_by_id(db, workspace.target_id)
        if target is None or target.sandbox_profile_id != workspace.sandbox_profile_id:
            raise CloudApiError(
                "cloud_target_profile_mismatch",
                "Cloud target is not attached to the workspace sandbox profile.",
                status_code=409,
            )
        await attach_target_to_runtime_environment(
            db,
            runtime_environment_id=runtime_environment.id,
            target_id=target.id,
        )
        workspace_row = await db.get(type(workspace), workspace.id)
        if workspace_row is not None:
            workspace_row.target_id = target.id
            workspace_row.updated_at = utcnow()

    repo_env_vars = {}
    repo_env_version = 0

    return CloudProvisionInput(
        workspace_id=workspace.id,
        runtime_environment_id=runtime_environment.id,
        user_id=workspace.user_id,
        git_owner=workspace.git_owner,
        git_repo_name=workspace.git_repo_name,
        git_branch=workspace.git_branch,
        git_base_branch=workspace.git_base_branch or workspace.git_branch,
        github_token=github_grant.access_token,
        git_user_name=git_user_name,
        git_user_email=git_user_email,
        anyharness_data_key=decrypt_text(anyharness_data_key_ciphertext),
        sandbox_profile_id=workspace.sandbox_profile_id,
        target_id=target.id,
        repo_env_vars=repo_env_vars,
        repo_env_version=repo_env_version,
        requested_base_sha=requested_base_sha,
    )
