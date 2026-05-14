"""Pure rules for cloud target environment materialization."""

from __future__ import annotations

from pathlib import PurePosixPath

from proliferate.constants.cloud import SUPPORTED_GIT_PROVIDER
from proliferate.server.cloud.errors import CloudApiError


def normalize_git_provider(value: str) -> str:
    normalized = value.strip().lower()
    if normalized != SUPPORTED_GIT_PROVIDER:
        raise CloudApiError(
            "target_config_git_provider_unsupported",
            f"Unsupported git provider for target config: {value}",
            status_code=400,
        )
    return normalized


def normalize_repo_component(value: str, *, field_name: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise CloudApiError(
            "target_config_repo_required",
            f"{field_name} is required.",
            status_code=400,
        )
    if "\x00" in normalized or "/" in normalized:
        raise CloudApiError(
            "target_config_repo_invalid",
            f"{field_name} is invalid.",
            status_code=400,
        )
    return normalized


def default_workspace_root(
    *,
    target_default_workspace_root: str | None,
    git_owner: str,
    git_repo_name: str,
) -> str:
    root = (target_default_workspace_root or "").strip() or "~/proliferate-workspaces"
    return f"{root.rstrip('/')}/{git_owner}/{git_repo_name}"


def normalize_workspace_root(value: str | None, *, fallback: str) -> str:
    normalized = (value or "").strip() or fallback
    if "\x00" in normalized:
        raise CloudApiError(
            "target_config_workspace_root_invalid",
            "workspaceRoot cannot contain NUL bytes.",
            status_code=400,
        )
    if normalized == "/" or normalized.endswith("/.."):
        raise CloudApiError(
            "target_config_workspace_root_invalid",
            "workspaceRoot is too broad.",
            status_code=400,
        )
    return str(PurePosixPath(normalized)) if normalized.startswith("/") else normalized.rstrip("/")


def require_workspace_root_under_target_root(
    *,
    workspace_root: str,
    target_root: str,
) -> None:
    normalized_workspace = workspace_root.rstrip("/")
    normalized_target = target_root.rstrip("/")
    if normalized_workspace == normalized_target:
        return
    if normalized_workspace.startswith(f"{normalized_target}/"):
        return
    raise CloudApiError(
        "target_config_workspace_root_outside_target_root",
        "workspaceRoot must be inside the target workspace root.",
        status_code=400,
    )


def normalize_identity_value(value: object | None) -> str | None:
    if isinstance(value, str):
        normalized = value.strip()
        if normalized:
            return normalized
    return None


def resolve_git_identity(user: object, github_account: object | None) -> tuple[str, str]:
    git_user_email = normalize_identity_value(getattr(github_account, "account_email", None))
    if git_user_email is None:
        git_user_email = normalize_identity_value(getattr(user, "email", None))
    if git_user_email is None:
        raise CloudApiError(
            "git_identity_required",
            "A usable email address is required to configure target git commits.",
            status_code=400,
        )

    git_user_name = normalize_identity_value(getattr(user, "display_name", None))
    if git_user_name is None:
        git_user_name = git_user_email.partition("@")[0].strip() or "Proliferate User"
    return git_user_name, git_user_email
