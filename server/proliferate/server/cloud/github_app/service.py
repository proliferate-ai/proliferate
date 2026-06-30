"""Product-facing GitHub App cloud authorization orchestration."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Protocol
from urllib.parse import urlencode, urlsplit
from uuid import UUID

from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.identity.routing import auth_route_path_for_base
from proliferate.config import settings
from proliferate.constants.auth import DESKTOP_REDIRECT_SCHEMES
from proliferate.db.store import github_app as github_app_store
from proliferate.integrations.github import (
    GitHubAppInstallationInfo,
    GitHubIntegrationError,
    exchange_github_app_code,
    fetch_installation_repo_coverage_from_github,
    list_github_app_installations,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app.models import (
    GitHubAppConnectResponse,
    GitHubAppStatusResponse,
)
from proliferate.utils.time import utcnow

_STATE_AUDIENCE = "github-app-connect"
_WEB_RETURN_PATHS = frozenset({"/settings", "/settings/account"})


class CurrentUser(Protocol):
    id: UUID


def _callback_url() -> str:
    base = settings.github_app_callback_base_url.strip() or settings.api_base_url.strip()
    if not base:
        raise CloudApiError(
            "github_app_not_configured",
            "GitHub App callback base URL is not configured.",
            status_code=503,
        )
    base = base.rstrip("/")
    path = auth_route_path_for_base("/auth/github-app/callback", base_url=base)
    return f"{base}{path}"


def _redirect_after_callback() -> str:
    base = settings.frontend_base_url.strip() or settings.api_base_url.strip() or "/"
    return base.rstrip("/") + "/settings/account" if base != "/" else "/"


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
        if parsed.hostname == "settings" and parsed.path in {"", "/", "/account"}:
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


def _state_for_user(user_id: UUID, *, return_to: str | None) -> str:
    now = datetime.now(UTC)
    payload: dict[str, object] = {
        "aud": _STATE_AUDIENCE,
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=10)).timestamp()),
    }
    if return_to:
        payload["return_to"] = return_to
    return jwt.encode(
        payload,
        settings.cloud_secret_key,
        algorithm="HS256",
    )


def _state_payload(state: str) -> tuple[UUID, str | None]:
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
            "GitHub App authorization state is invalid or expired.",
            status_code=400,
        ) from exc
    subject = payload.get("sub")
    if not isinstance(subject, str):
        raise CloudApiError(
            "github_app_state_invalid",
            "GitHub App authorization state is invalid or expired.",
            status_code=400,
        )
    try:
        user_id = UUID(subject)
    except ValueError as exc:
        raise CloudApiError(
            "github_app_state_invalid",
            "GitHub App authorization state is invalid or expired.",
            status_code=400,
        ) from exc
    return_to = payload.get("return_to")
    return user_id, return_to if isinstance(return_to, str) and return_to else None


async def create_github_app_connect_url(
    db: AsyncSession,
    *,
    user: CurrentUser,
    return_to: str | None = None,
) -> GitHubAppConnectResponse:
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
            "redirect_uri": _callback_url(),
            "state": _state_for_user(user.id, return_to=validated_return_to),
        }
    )
    return GitHubAppConnectResponse(
        authorization_url=f"https://github.com/login/oauth/authorize?{query}",
    )


async def complete_github_app_callback(
    db: AsyncSession,
    *,
    code: str,
    state: str,
) -> str:
    user_id, return_to = _state_payload(state)
    try:
        authorization = await exchange_github_app_code(code=code, redirect_uri=_callback_url())
    except GitHubIntegrationError as exc:
        raise CloudApiError(
            "github_app_authorization_failed",
            "Could not connect the Proliferate GitHub App.",
            status_code=502,
        ) from exc
    await github_app_store.upsert_github_app_authorization(
        db,
        user_id=user_id,
        authorization=authorization,
    )
    await refresh_github_app_installation_cache(db)
    return return_to or _redirect_after_callback()


async def refresh_github_app_installation_cache(db: AsyncSession) -> None:
    try:
        installations = await list_github_app_installations()
    except GitHubIntegrationError:
        return
    for installation in installations:
        await github_app_store.upsert_github_app_installation(db, installation=installation)


async def get_github_app_status(
    db: AsyncSession,
    *,
    user: CurrentUser,
    git_owner: str | None,
    git_repo_name: str | None,
) -> GitHubAppStatusResponse:
    authorization = await github_app_store.get_github_app_authorization_for_user(
        db,
        user_id=user.id,
    )
    if authorization is None:
        return GitHubAppStatusResponse(connected=False, action="connect")
    status = authorization.status
    now = utcnow()
    if authorization.token_expires_at is not None and authorization.token_expires_at <= now:
        status = "needs_reauth"
    base = GitHubAppStatusResponse(
        connected=status == "ready",
        github_login=authorization.github_login,
        status=status,
        token_expires_at=authorization.token_expires_at,
        action="reauthorize" if status in {"expired", "needs_reauth"} else None,
    )
    if git_owner is None or git_repo_name is None or status != "ready":
        return base

    installations = await github_app_store.list_active_github_app_installations_for_owner(
        db,
        owner=git_owner,
    )
    if not installations:
        await refresh_github_app_installation_cache(db)
        installations = await github_app_store.list_active_github_app_installations_for_owner(
            db,
            owner=git_owner,
        )
    if not installations:
        return base.model_copy(
            update={
                "installation_state": "missing",
                "repo_covered": False,
                "action": "install",
            }
        )
    if any(item.repository_selection == "all" for item in installations):
        return base.model_copy(
            update={
                "installation_state": "installed",
                "repo_covered": True,
                "action": None,
            }
        )
    for installation in installations:
        cached = await github_app_store.get_fresh_installation_repo_cache(
            db,
            installation_id=installation.id,
            git_owner=git_owner,
            git_repo_name=git_repo_name,
        )
        if cached is not None:
            return base.model_copy(
                update={
                    "installation_state": "installed",
                    "repo_covered": True,
                    "action": None,
                }
            )
        if authorization.access_token is None:
            continue
        try:
            coverage = await fetch_installation_repo_coverage_from_github(
                user_access_token=authorization.access_token,
                installation_id=installation.github_installation_id,
                git_owner=git_owner,
                git_repo_name=git_repo_name,
            )
        except GitHubIntegrationError:
            continue
        await github_app_store.upsert_installation_repo_cache(
            db,
            installation_id=installation.id,
            owner=git_owner,
            name=git_repo_name,
            coverage=coverage,
        )
        if coverage.covered:
            return base.model_copy(
                update={
                    "installation_state": "installed",
                    "repo_covered": True,
                    "action": None,
                }
            )
    return base.model_copy(
        update={
            "installation_state": "installed",
            "repo_covered": False,
            "action": "grant_repo_access",
        }
    )


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
