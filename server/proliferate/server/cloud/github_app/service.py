"""Product-facing GitHub App cloud authorization orchestration."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Literal, Protocol
from urllib.parse import quote, urlencode, urlsplit
from uuid import UUID

from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.routing import auth_route_path_for_base
from proliferate.config import settings
from proliferate.constants.auth import DESKTOP_REDIRECT_SCHEMES
from proliferate.db.store import github_app as github_app_store
from proliferate.db.store import repositories as repositories_store
from proliferate.integrations.github import (
    GitHubAppInstallationInfo,
    GitHubIntegrationError,
    exchange_github_app_code,
    get_github_app_installation,
    list_github_app_installations,
)
from proliferate.server.cloud.cloud_sandboxes import service as cloud_sandboxes_service
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app.models import (
    GitHubAppInstallationStartResponse,
    GitHubAppInstallationStatusResponse,
    GitHubAppUserAuthorizationStartResponse,
    GitHubAppUserAuthorizationStatusResponse,
    GitHubRepoAuthorityResponse,
    RepoAuthorityAction,
    RepoAuthorityStatus,
)
from proliferate.server.cloud.github_app.repo_authority import (
    ensure_fresh_github_app_authorization,
    require_github_cloud_repo_authority,
)
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.server.cloud.repos.domain.catalog import CloudGitRepositoriesPageRecord
from proliferate.server.cloud.repos.domain.github_credentials import (
    CloudRepoGitHubCredentials,
)
from proliferate.server.cloud.repos.service import (
    DEFAULT_REPO_AFFILIATION,
    DEFAULT_REPO_VISIBILITY,
    list_cloud_repositories,
)
from proliferate.utils.time import utcnow

_STATE_AUDIENCE = "github-app-cloud"
_STATE_KIND_USER_AUTH = "user_authorization"
_STATE_KIND_INSTALLATION = "installation"
_WEB_RETURN_PATHS = frozenset(
    {
        "/settings",
        "/settings/account",
        "/settings/organization",
        "/settings/organizations",
    }
)


class CurrentUser(Protocol):
    id: UUID


class CurrentOrgUser(Protocol):
    actor_user_id: UUID
    organization_id: UUID


def _callback_base_url() -> str:
    base = settings.github_app_callback_base_url.strip() or settings.api_base_url.strip()
    if not base:
        raise CloudApiError(
            "github_app_not_configured",
            "GitHub App callback base URL is not configured.",
            status_code=503,
        )
    return base.rstrip("/")


def _callback_url(path: str) -> str:
    base = _callback_base_url()
    route_path = auth_route_path_for_base(path, base_url=base)
    return f"{base}{route_path}"


def _default_return_after_callback(section: Literal["account", "organization"]) -> str:
    base = settings.frontend_base_url.strip() or settings.api_base_url.strip() or "/"
    if base == "/":
        return "/"
    return base.rstrip("/") + f"/settings/{section}"


def _validate_return_to(return_to: str | None) -> str | None:
    if return_to is None:
        return None
    value = return_to.strip()
    if not value or any(ord(char) < 32 for char in value):
        raise CloudApiError(
            "github_app_return_target_invalid",
            "GitHub App return target is invalid.",
            status_code=400,
        )
    parsed = urlsplit(value)
    if parsed.scheme in DESKTOP_REDIRECT_SCHEMES:
        if parsed.hostname == "settings" and parsed.path in {
            "",
            "/",
            "/account",
            "/environments",
            "/organization",
            "/organizations",
        }:
            return value
        raise CloudApiError(
            "github_app_return_target_invalid",
            "GitHub App desktop return target is not allowed.",
            status_code=400,
        )
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        frontend_base = settings.frontend_base_url.strip().rstrip("/")
        frontend = urlsplit(frontend_base) if frontend_base else None
        if (
            frontend is not None
            and parsed.scheme == frontend.scheme
            and parsed.netloc == frontend.netloc
            and parsed.path in _WEB_RETURN_PATHS
            and not parsed.fragment
        ):
            return value
    raise CloudApiError(
        "github_app_return_target_invalid",
        "GitHub App return target is not allowed.",
        status_code=400,
    )


def _state_for_user_authorization(user_id: UUID, *, return_to: str | None) -> str:
    return _state_for(
        kind=_STATE_KIND_USER_AUTH,
        user_id=user_id,
        organization_id=None,
        return_to=return_to,
    )


def _state_for_installation(
    *,
    user_id: UUID,
    organization_id: UUID,
    return_to: str | None,
) -> str:
    return _state_for(
        kind=_STATE_KIND_INSTALLATION,
        user_id=user_id,
        organization_id=organization_id,
        return_to=return_to,
    )


def _state_for(
    *,
    kind: Literal["user_authorization", "installation"],
    user_id: UUID,
    organization_id: UUID | None,
    return_to: str | None,
) -> str:
    now = datetime.now(UTC)
    payload: dict[str, object] = {
        "aud": _STATE_AUDIENCE,
        "kind": kind,
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=10)).timestamp()),
    }
    if organization_id is not None:
        payload["organization_id"] = str(organization_id)
    if return_to:
        payload["return_to"] = return_to
    return jwt.encode(
        payload,
        settings.cloud_secret_key,
        algorithm="HS256",
    )


def _state_payload(
    state: str,
    *,
    expected_kind: Literal["user_authorization", "installation"],
) -> tuple[UUID, UUID | None, str | None]:
    try:
        payload = jwt.decode(
            state,
            settings.cloud_secret_key,
            algorithms=["HS256"],
            audience=_STATE_AUDIENCE,
        )
    except JWTError as exc:
        raise CloudApiError(
            "github_app_state_invalid",
            "GitHub App state is invalid or expired.",
            status_code=400,
        ) from exc
    if payload.get("kind") != expected_kind:
        raise CloudApiError(
            "github_app_state_invalid",
            "GitHub App state is invalid or expired.",
            status_code=400,
        )
    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise CloudApiError(
            "github_app_state_invalid",
            "GitHub App state is invalid or expired.",
            status_code=400,
        )
    try:
        user_id = UUID(subject)
    except ValueError as exc:
        raise CloudApiError(
            "github_app_state_invalid",
            "GitHub App state is invalid or expired.",
            status_code=400,
        ) from exc
    organization_id_value = payload.get("organization_id")
    organization_id = None
    if isinstance(organization_id_value, str):
        try:
            organization_id = UUID(organization_id_value)
        except ValueError as exc:
            raise CloudApiError(
                "github_app_state_invalid",
                "GitHub App state is invalid or expired.",
                status_code=400,
            ) from exc
    return_to = payload.get("return_to")
    validated_return_to = return_to if isinstance(return_to, str) and return_to else None
    return user_id, organization_id, validated_return_to


async def create_github_app_user_authorization_url(
    db: AsyncSession,
    *,
    user: CurrentUser,
    return_to: str | None = None,
) -> GitHubAppUserAuthorizationStartResponse:
    del db
    client_id = settings.github_app_client_id.strip()
    if not client_id:
        raise CloudApiError(
            "github_app_not_configured",
            "GitHub App authorization is not configured.",
            status_code=503,
        )
    validated_return_to = _validate_return_to(return_to)
    query = urlencode(
        {
            "client_id": client_id,
            "redirect_uri": _callback_url("/auth/github-app/user-authorization/callback"),
            "state": _state_for_user_authorization(user.id, return_to=validated_return_to),
        }
    )
    return GitHubAppUserAuthorizationStartResponse(
        authorization_url=f"https://github.com/login/oauth/authorize?{query}",
    )


async def complete_github_app_user_authorization_callback(
    db: AsyncSession,
    *,
    code: str,
    state: str,
) -> str:
    user_id, _organization_id, return_to = _state_payload(
        state,
        expected_kind=_STATE_KIND_USER_AUTH,
    )
    try:
        authorization = await exchange_github_app_code(
            code=code,
            redirect_uri=_callback_url("/auth/github-app/user-authorization/callback"),
        )
    except GitHubIntegrationError as exc:
        raise CloudApiError(
            "github_app_authorization_failed",
            "Could not authorize the Proliferate GitHub App.",
            status_code=502,
        ) from exc
    await github_app_store.upsert_github_app_authorization(
        db,
        user_id=user_id,
        authorization=authorization,
    )
    await cloud_sandboxes_service.ensure_personal_cloud_sandbox_exists(db, user_id=user_id)
    await materialization_service.schedule_materialize_sandbox(db, user_id=user_id)
    await refresh_github_app_installation_cache(db)
    return return_to or _default_return_after_callback("account")


async def get_github_app_user_authorization_status(
    db: AsyncSession,
    *,
    user: CurrentUser,
) -> GitHubAppUserAuthorizationStatusResponse:
    authorization = await github_app_store.get_github_app_authorization_for_user(
        db,
        user_id=user.id,
    )
    if authorization is None:
        return GitHubAppUserAuthorizationStatusResponse(
            connected=False,
            action="authorize",
        )
    status = authorization.status
    now = utcnow()
    if authorization.token_expires_at is not None and authorization.token_expires_at <= now:
        status = "needs_reauth"
    return GitHubAppUserAuthorizationStatusResponse(
        connected=status == "ready",
        github_login=authorization.github_login,
        status=status,
        token_expires_at=authorization.token_expires_at,
        action="reauthorize" if status in {"expired", "needs_reauth"} else None,
    )


async def create_github_app_installation_url(
    db: AsyncSession,
    *,
    org_user: CurrentOrgUser,
    return_to: str | None = None,
) -> GitHubAppInstallationStartResponse:
    del db
    slug = settings.github_app_slug.strip()
    if not slug:
        raise CloudApiError(
            "github_app_not_configured",
            "GitHub App slug is not configured.",
            status_code=503,
        )
    validated_return_to = _validate_return_to(return_to)
    state = _state_for_installation(
        user_id=org_user.actor_user_id,
        organization_id=org_user.organization_id,
        return_to=validated_return_to,
    )
    query = urlencode({"state": state})
    installation_url = f"https://github.com/apps/{quote(slug, safe='')}/installations/new?{query}"
    return GitHubAppInstallationStartResponse(
        installation_url=installation_url,
    )


async def complete_github_app_installation_callback(
    db: AsyncSession,
    *,
    installation_id: str | None,
    setup_action: str | None,
    state: str,
) -> str:
    del setup_action
    actor_user_id, organization_id, return_to = _state_payload(
        state,
        expected_kind=_STATE_KIND_INSTALLATION,
    )
    if organization_id is None:
        raise CloudApiError(
            "github_app_state_invalid",
            "GitHub App installation state is invalid or expired.",
            status_code=400,
        )
    if installation_id is None or not installation_id.strip():
        raise CloudApiError(
            "github_app_installation_id_required",
            "GitHub App installation callback is missing the installation id.",
            status_code=400,
        )
    try:
        installation = await get_github_app_installation(
            installation_id=installation_id.strip(),
        )
    except GitHubIntegrationError as exc:
        raise CloudApiError(
            "github_app_installation_lookup_failed",
            "Could not verify GitHub App installation.",
            status_code=502,
        ) from exc
    await github_app_store.upsert_github_app_installation(
        db,
        installation=installation,
        organization_id=organization_id,
        installed_by_user_id=actor_user_id,
    )
    repo_environments = await repositories_store.list_cloud_repo_environments_for_git_owner(
        db,
        git_owner=installation.account_login,
    )
    for repo_environment in repo_environments:
        await materialization_service.schedule_materialize_repo_environment(
            db,
            repo_environment_id=repo_environment.id,
        )
    return return_to or _default_return_after_callback("organization")


async def get_github_app_installation_status(
    db: AsyncSession,
    *,
    org_user: CurrentOrgUser,
) -> GitHubAppInstallationStatusResponse:
    installation = await github_app_store.get_github_app_installation_for_organization(
        db,
        organization_id=org_user.organization_id,
    )
    if installation is None:
        return GitHubAppInstallationStatusResponse(installed=False, action="install")
    installed = installation.suspended_at is None and installation.deleted_at is None
    return GitHubAppInstallationStatusResponse(
        installed=installed,
        installation_id=installation.github_installation_id,
        account_login=installation.account_login,
        account_type=installation.account_type,
        repository_selection=installation.repository_selection,
        suspended_at=installation.suspended_at,
        action="manage" if installed else "install",
    )


async def get_github_repo_authority_status(
    db: AsyncSession,
    *,
    user: CurrentUser,
    git_owner: str,
    git_repo_name: str,
) -> GitHubRepoAuthorityResponse:
    try:
        await require_github_cloud_repo_authority(
            db,
            user_id=user.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
    except CloudApiError as exc:
        status, action = _repo_authority_status_for_error(exc.code)
        if status == "error":
            return GitHubRepoAuthorityResponse(
                authorized=False,
                status=status,
                action=action,
                message=exc.message,
            )
        return GitHubRepoAuthorityResponse(
            authorized=False,
            status=status,
            action=action,
            message=exc.message,
        )
    return GitHubRepoAuthorityResponse(authorized=True, status="ready")


def _repo_authority_status_for_error(
    code: str,
) -> tuple[RepoAuthorityStatus, RepoAuthorityAction | None]:
    if code == "github_app_authorization_required":
        return "missing_user_authorization", "authorize_user"
    if code == "github_app_authorization_expired":
        return "expired_user_authorization", "reauthorize_user"
    if code == "github_app_installation_required":
        return "missing_installation", "install_app"
    if code == "github_app_repo_not_covered":
        return "repo_not_covered", "grant_repo_access"
    if code == "github_repo_access_required":
        return "missing_user_repo_access", "authorize_user"
    return "error", None


async def list_github_app_accessible_repositories(
    db: AsyncSession,
    *,
    user: CurrentUser,
    query: str | None = None,
    cursor: str | None = None,
    limit: int = 50,
    affiliation: str = DEFAULT_REPO_AFFILIATION,
    visibility: str = DEFAULT_REPO_VISIBILITY,
) -> CloudGitRepositoriesPageRecord:
    authorization = await ensure_fresh_github_app_authorization(db, user_id=user.id)
    credentials = CloudRepoGitHubCredentials(
        user_id=user.id,
        access_token=authorization.access_token,
    )
    return await list_cloud_repositories(
        db,
        credentials,
        query=query,
        cursor=cursor,
        limit=limit,
        affiliation=affiliation,
        visibility=visibility,
    )


async def refresh_github_app_installation_cache(db: AsyncSession) -> None:
    try:
        installations = await list_github_app_installations()
    except GitHubIntegrationError:
        return
    for installation in installations:
        await github_app_store.upsert_github_app_installation(db, installation=installation)


def installation_info_from_webhook(payload: dict[str, object]) -> GitHubAppInstallationInfo | None:
    installation = payload.get("installation")
    if not isinstance(installation, dict):
        return None
    account = installation.get("account")
    if not isinstance(account, dict):
        return None
    installation_id = installation.get("id")
    account_login = account.get("login")
    account_type = account.get("type")
    repository_selection = installation.get("repository_selection")
    permissions = installation.get("permissions")
    if (
        not isinstance(installation_id, (int, str))
        or not isinstance(account_login, str)
        or not isinstance(account_type, str)
        or not isinstance(repository_selection, str)
    ):
        return None
    return GitHubAppInstallationInfo(
        github_installation_id=str(installation_id),
        account_login=account_login,
        account_type=account_type,
        repository_selection=repository_selection,
        permissions=permissions if isinstance(permissions, dict) else {},
        suspended_at=None,
    )
