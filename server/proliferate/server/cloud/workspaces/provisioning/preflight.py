from __future__ import annotations

from typing import NoReturn
from uuid import UUID

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER
from proliferate.db import session_ops as db_session
from proliferate.db.store import cloud_sandbox_profiles as sandbox_profile_store
from proliferate.db.store.cloud_agent_auth import store as agent_auth_store
from proliferate.db.store.cloud_repo_config import (
    get_cloud_repo_config,
    get_organization_cloud_repo_config,
)
from proliferate.db.store.cloud_workspaces import (
    CloudRepoLimitExceededError,
    get_existing_managed_cloud_workspace_for_profile,
    load_any_cloud_workspace_for_repo,
    load_existing_cloud_workspace,
)
from proliferate.server.billing.models import SandboxStartAuthorization
from proliferate.server.billing.service import (
    authorize_sandbox_start,
    authorize_sandbox_start_for_billing_subject,
    get_billing_snapshot_for_subject,
    repo_limit_for_billing_snapshot,
)
from proliferate.server.cloud.agent_auth.domain.status import allowed_agent_kinds
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.repo_config.service import (
    bootstrap_repo_config,
    load_repo_config_value,
)
from proliferate.server.cloud.repos.service import (
    get_linked_github_account,
)
from proliferate.server.cloud.repos.service import (
    get_repo_branches_for_user as get_github_repo_branches,
)
from proliferate.server.cloud.runtime.credentials.auth_status import (
    selected_agent_auth_agent_kinds,
)
from proliferate.server.cloud.workspaces.details import cloud_workspace_block_message
from proliferate.server.cloud.workspaces.provisioning.models import (
    ResolvedCloudWorkspaceCreate,
)


def raise_if_cloud_workspace_start_denied(
    authorization: SandboxStartAuthorization,
) -> None:
    if authorization.allowed:
        return
    raise CloudApiError(
        "quota_exceeded",
        authorization.message or cloud_workspace_block_message(authorization.start_block_reason),
        status_code=403,
    )


def raise_repo_limit_exceeded(error: CloudRepoLimitExceededError) -> NoReturn:
    raise CloudApiError(
        "repo_limit_exceeded",
        (
            "Cloud repo limit reached. Archive an existing cloud repo before adding "
            f"another one ({error.active_repo_count}/{error.cloud_repo_limit})."
        ),
        status_code=403,
    ) from error


async def load_personal_agent_auth_agent_kinds(user_id: UUID) -> tuple[str, ...]:
    async with db_session.open_async_session() as db:
        profile = await agent_auth_store.get_active_personal_sandbox_profile_for_user(
            db,
            user_id,
        )
        if profile is None:
            return ()
        result = await selected_agent_auth_agent_kinds(
            db,
            sandbox_profile_id=profile.id,
        )
        return result


async def load_repo_config_value_tx(
    user_id: UUID, git_owner: str, git_repo_name: str
) -> object | None:
    async with db_session.open_async_session() as db:
        return await load_repo_config_value(
            db, user_id=user_id, git_owner=git_owner, git_repo_name=git_repo_name
        )


async def bootstrap_repo_config_tx(user_id: UUID, git_owner: str, git_repo_name: str) -> object:
    async with db_session.open_async_transaction() as db:
        return await bootstrap_repo_config(
            db, user_id=user_id, git_owner=git_owner, git_repo_name=git_repo_name
        )


async def resolve_new_cloud_workspace_create(
    user: ActorIdentity,
    *,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    base_branch: str | None,
    branch_name: str,
    display_name: str | None,
    required_agent_kind: str | None = None,
) -> ResolvedCloudWorkspaceCreate:
    if git_provider != SUPPORTED_GIT_PROVIDER:
        raise CloudApiError(
            "unsupported_repo_provider",
            "Only GitHub repositories are supported for cloud workspaces.",
            status_code=400,
        )

    if get_linked_github_account(user) is None:
        raise CloudApiError(
            "github_link_required",
            "Connect a GitHub account before creating a cloud workspace.",
            status_code=400,
        )

    cleaned_base_branch = base_branch.strip() if base_branch else ""
    cleaned_branch_name = branch_name.strip()
    if not cleaned_branch_name:
        raise CloudApiError(
            "invalid_branch_request",
            "Choose a new cloud branch before creating a cloud workspace.",
            status_code=400,
        )

    repo_config = await load_repo_config_value_tx(user.id, git_owner, git_repo_name)
    if repo_config is None or not repo_config.configured:
        async with db_session.open_async_session() as db:
            existing_repo_workspace = await load_any_cloud_workspace_for_repo(
                db,
                user_id=user.id,
                git_owner=git_owner,
                git_repo_name=git_repo_name,
            )
        if existing_repo_workspace is None:
            raise CloudApiError(
                "cloud_repo_not_configured",
                "Configure cloud settings for this repo before creating a cloud workspace.",
                status_code=409,
            )
        repo_config = await bootstrap_repo_config_tx(user.id, git_owner, git_repo_name)
        log_cloud_event(
            "cloud repo config auto-bootstrapped",
            user_id=user.id,
            repo=f"{git_owner}/{git_repo_name}",
        )

    repo_branches = await get_github_repo_branches(
        user,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        missing_access_message="Connect a GitHub account before creating a cloud workspace.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before creating a cloud workspace."
        ),
    )

    resolved_base_branch = cleaned_base_branch or None
    saved_default_branch = (repo_config.default_branch or "").strip() or None
    if resolved_base_branch is None and saved_default_branch:
        if saved_default_branch in repo_branches.branches:
            resolved_base_branch = saved_default_branch
        else:
            log_cloud_event(
                "cloud repo default branch missing on github; falling back",
                user_id=user.id,
                repo=f"{git_owner}/{git_repo_name}",
                saved_default_branch=saved_default_branch,
                github_default_branch=repo_branches.default_branch,
            )
    if resolved_base_branch is None:
        resolved_base_branch = repo_branches.default_branch.strip()

    if resolved_base_branch not in repo_branches.branches:
        raise CloudApiError(
            "github_branch_not_found",
            f"The base branch '{resolved_base_branch}' was not found on GitHub.",
            status_code=400,
        )
    if cleaned_branch_name in repo_branches.branches:
        raise CloudApiError(
            "github_branch_already_exists",
            f"The branch '{cleaned_branch_name}' already exists on GitHub.",
            status_code=400,
        )

    async with db_session.open_async_session() as db:
        existing_cloud_workspace = await load_existing_cloud_workspace(
            db,
            user_id=user.id,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=cleaned_branch_name,
        )
    if existing_cloud_workspace is not None:
        raise CloudApiError(
            "cloud_branch_already_exists",
            (
                f"A cloud workspace already exists for branch '{cleaned_branch_name}'. "
                "Open the existing cloud workspace or choose a different cloud branch."
            ),
            status_code=400,
        )

    authorization = await authorize_sandbox_start(
        user_id=user.id,
        workspace_id=None,
    )
    raise_if_cloud_workspace_start_denied(authorization)
    billing_snapshot = await get_billing_snapshot_for_subject(authorization.billing_subject_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)

    if required_agent_kind is not None and required_agent_kind not in allowed_agent_kinds():
        raise CloudApiError(
            "unsupported_agent_kind",
            "The selected agent is not supported for cloud workspaces.",
            status_code=400,
        )

    selected_agent_kinds = await load_personal_agent_auth_agent_kinds(user.id)
    if required_agent_kind is not None and required_agent_kind not in selected_agent_kinds:
        raise CloudApiError(
            "missing_agent_credentials",
            (
                f"Select {required_agent_kind} agent authentication before running "
                "this cloud automation."
            ),
            status_code=400,
        )
    if not selected_agent_kinds:
        raise CloudApiError(
            "missing_supported_credentials",
            "Select an agent authentication credential before creating a cloud workspace.",
            status_code=400,
        )
    log_cloud_event(
        "cloud workspace create validated",
        repo=f"{git_owner}/{git_repo_name}",
        base_branch=resolved_base_branch,
        branch_name=cleaned_branch_name,
        selected_agent_kinds=",".join(selected_agent_kinds),
        active_sandbox_count=authorization.active_sandbox_count,
    )
    return ResolvedCloudWorkspaceCreate(
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=cleaned_branch_name,
        git_base_branch=resolved_base_branch,
        display_name=(display_name.strip() if display_name and display_name.strip() else None),
        active_sandbox_count=authorization.active_sandbox_count,
        selected_agent_kinds=selected_agent_kinds,
        cloud_repo_limit=cloud_repo_limit,
    )


async def resolve_new_managed_cloud_workspace_create(
    user: ActorIdentity,
    *,
    sandbox_profile_id: UUID,
    target_id: UUID,
    git_provider: str,
    git_owner: str,
    git_repo_name: str,
    base_branch: str | None,
    branch_name: str,
    display_name: str | None,
    required_agent_kind: str | None = None,
) -> ResolvedCloudWorkspaceCreate:
    if git_provider != SUPPORTED_GIT_PROVIDER:
        raise CloudApiError(
            "unsupported_repo_provider",
            "Only GitHub repositories are supported for cloud workspaces.",
            status_code=400,
        )

    if get_linked_github_account(user) is None:
        raise CloudApiError(
            "github_link_required",
            "Connect a GitHub account before creating a cloud workspace.",
            status_code=400,
        )

    cleaned_base_branch = base_branch.strip() if base_branch else ""
    cleaned_branch_name = branch_name.strip()
    if not cleaned_branch_name:
        raise CloudApiError(
            "invalid_branch_request",
            "Choose a new cloud branch before creating a cloud workspace.",
            status_code=400,
        )

    async with db_session.open_async_session() as db:
        profile = await sandbox_profile_store.load_sandbox_profile_by_id(db, sandbox_profile_id)
        if profile is None or profile.primary_target_id != target_id:
            raise CloudApiError(
                "cloud_target_not_found",
                "Cloud target not found.",
                status_code=404,
            )
        if profile.owner_scope == "organization":
            if profile.organization_id is None:
                raise CloudApiError(
                    "invalid_sandbox_profile",
                    "Organization sandbox profile is invalid.",
                    status_code=409,
                )
            repo_config = await get_organization_cloud_repo_config(
                db,
                organization_id=profile.organization_id,
                git_owner=git_owner,
                git_repo_name=git_repo_name,
            )
        else:
            if profile.owner_user_id is None:
                raise CloudApiError(
                    "invalid_sandbox_profile",
                    "Personal sandbox profile is invalid.",
                    status_code=409,
                )
            repo_config = await get_cloud_repo_config(
                db,
                user_id=profile.owner_user_id,
                git_owner=git_owner,
                git_repo_name=git_repo_name,
            )
        if repo_config is None or not repo_config.configured:
            raise CloudApiError(
                "cloud_repo_not_configured",
                "Configure cloud settings for this repo before creating a cloud workspace.",
                status_code=409,
            )
        existing_cloud_workspace = await get_existing_managed_cloud_workspace_for_profile(
            db,
            sandbox_profile_id=profile.id,
            target_id=target_id,
            git_provider=git_provider,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
            git_branch=cleaned_branch_name,
        )
        if existing_cloud_workspace is not None:
            raise CloudApiError(
                "cloud_branch_already_exists",
                (
                    f"A cloud workspace already exists for branch '{cleaned_branch_name}'. "
                    "Open the existing cloud workspace or choose a different cloud branch."
                ),
                status_code=400,
            )
        selected_agent_kinds = await selected_agent_auth_agent_kinds(
            db,
            sandbox_profile_id=profile.id,
        )
        billing_subject_id = profile.billing_subject_id
        saved_default_branch = (repo_config.default_branch or "").strip() or None
        profile_owner_scope = profile.owner_scope

    repo_branches = await get_github_repo_branches(
        user,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        missing_access_message="Connect a GitHub account before creating a cloud workspace.",
        repo_access_required_message=(
            "Reconnect GitHub and grant repository access before creating a cloud workspace."
        ),
    )

    resolved_base_branch = cleaned_base_branch or None
    if resolved_base_branch is None and saved_default_branch:
        if saved_default_branch in repo_branches.branches:
            resolved_base_branch = saved_default_branch
        else:
            log_cloud_event(
                "managed cloud repo default branch missing on github; falling back",
                user_id=user.id,
                repo=f"{git_owner}/{git_repo_name}",
                saved_default_branch=saved_default_branch,
                github_default_branch=repo_branches.default_branch,
            )
    if resolved_base_branch is None:
        resolved_base_branch = repo_branches.default_branch.strip()

    if resolved_base_branch not in repo_branches.branches:
        raise CloudApiError(
            "github_branch_not_found",
            f"The base branch '{resolved_base_branch}' was not found on GitHub.",
            status_code=400,
        )
    if cleaned_branch_name in repo_branches.branches:
        raise CloudApiError(
            "github_branch_already_exists",
            f"The branch '{cleaned_branch_name}' already exists on GitHub.",
            status_code=400,
        )

    authorization = await authorize_sandbox_start_for_billing_subject(
        actor_user_id=user.id,
        billing_subject_id=billing_subject_id,
    )
    raise_if_cloud_workspace_start_denied(authorization)
    billing_snapshot = await get_billing_snapshot_for_subject(authorization.billing_subject_id)
    cloud_repo_limit = repo_limit_for_billing_snapshot(billing_snapshot)

    if required_agent_kind is not None and required_agent_kind not in allowed_agent_kinds():
        raise CloudApiError(
            "unsupported_agent_kind",
            "The selected agent is not supported for cloud workspaces.",
            status_code=400,
        )
    if profile_owner_scope == "personal":
        if required_agent_kind is not None and required_agent_kind not in selected_agent_kinds:
            raise CloudApiError(
                "missing_agent_credentials",
                (
                    f"Select {required_agent_kind} agent authentication before running "
                    "this cloud automation."
                ),
                status_code=400,
            )
        if not selected_agent_kinds:
            raise CloudApiError(
                "missing_supported_credentials",
                "Select an agent authentication credential before creating a cloud workspace.",
                status_code=400,
            )

    log_cloud_event(
        "managed cloud workspace create validated",
        repo=f"{git_owner}/{git_repo_name}",
        base_branch=resolved_base_branch,
        branch_name=cleaned_branch_name,
        selected_agent_kinds=",".join(selected_agent_kinds),
        active_sandbox_count=authorization.active_sandbox_count,
        owner_scope=profile_owner_scope,
        sandbox_profile_id=sandbox_profile_id,
        target_id=target_id,
    )
    return ResolvedCloudWorkspaceCreate(
        git_provider=git_provider,
        git_owner=git_owner,
        git_repo_name=git_repo_name,
        git_branch=cleaned_branch_name,
        git_base_branch=resolved_base_branch,
        display_name=(display_name.strip() if display_name and display_name.strip() else None),
        active_sandbox_count=authorization.active_sandbox_count,
        selected_agent_kinds=selected_agent_kinds,
        cloud_repo_limit=cloud_repo_limit,
    )
