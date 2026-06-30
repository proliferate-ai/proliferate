"""GitHub App user authorization token helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from proliferate.config import settings
from proliferate.integrations.github.repos import GitHubIntegrationError, GitHubUserProfile

_TOKEN_URL = "https://github.com/login/oauth/access_token"


class GitHubAppInvalidGrant(GitHubIntegrationError):
    pass


@dataclass(frozen=True, repr=False)
class GitHubAppUserAuthorization:
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    refresh_token_expires_at: datetime | None
    github_user_id: str
    github_login: str
    permissions: dict[str, object]


def _expires_at_from_seconds(value: object) -> datetime | None:
    if not isinstance(value, (int, float)):
        return None
    return datetime.fromtimestamp(int(datetime.now(UTC).timestamp() + value), tz=UTC)


def _require_config() -> tuple[str, str]:
    client_id = settings.github_app_client_id.strip()
    client_secret = settings.github_app_client_secret.strip()
    if not client_id or not client_secret:
        raise GitHubIntegrationError("GitHub App OAuth is not configured.")
    return client_id, client_secret


async def _post_token(data: dict[str, str]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                _TOKEN_URL,
                headers={"Accept": "application/json"},
                data=data,
            )
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError("Could not exchange GitHub App authorization.") from exc
    try:
        payload = response.json()
    except ValueError as exc:
        raise GitHubIntegrationError("GitHub App authorization response was invalid.") from exc
    if not isinstance(payload, dict):
        raise GitHubIntegrationError("GitHub App authorization response was invalid.")
    error = payload.get("error")
    if error == "invalid_grant":
        raise GitHubAppInvalidGrant("GitHub App authorization expired.")
    if response.status_code >= 300 or error:
        raise GitHubIntegrationError("Could not exchange GitHub App authorization.")
    return payload


async def exchange_github_app_code(
    *,
    code: str,
    redirect_uri: str | None = None,
) -> GitHubAppUserAuthorization:
    client_id, client_secret = _require_config()
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
    }
    if redirect_uri:
        data["redirect_uri"] = redirect_uri
    payload = await _post_token(data)
    return await _authorization_from_token_payload(payload)


async def refresh_github_app_user_authorization(
    *,
    refresh_token: str,
) -> GitHubAppUserAuthorization:
    client_id, client_secret = _require_config()
    payload = await _post_token(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
    )
    return await _authorization_from_token_payload(payload)


async def _authorization_from_token_payload(
    payload: dict[str, Any],
) -> GitHubAppUserAuthorization:
    access_token = payload.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise GitHubIntegrationError("GitHub App authorization did not return an access token.")
    refresh_token = payload.get("refresh_token")
    profile = await get_github_app_user_profile(access_token.strip())
    return GitHubAppUserAuthorization(
        access_token=access_token.strip(),
        refresh_token=refresh_token.strip()
        if isinstance(refresh_token, str) and refresh_token.strip()
        else None,
        expires_at=_expires_at_from_seconds(payload.get("expires_in")),
        refresh_token_expires_at=_expires_at_from_seconds(payload.get("refresh_token_expires_in")),
        github_user_id=profile.github_user_id,
        github_login=profile.profile.login,
        permissions={},
    )


@dataclass(frozen=True)
class GitHubAppUserProfile:
    github_user_id: str
    profile: GitHubUserProfile


async def get_github_app_user_profile(access_token: str) -> GitHubAppUserProfile:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.github.com/user",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError("Could not load GitHub App user profile.") from exc
    if response.status_code >= 300:
        raise GitHubIntegrationError("Could not load GitHub App user profile.")
    try:
        payload = response.json()
    except ValueError as exc:
        raise GitHubIntegrationError("Could not load GitHub App user profile.") from exc
    if not isinstance(payload, dict):
        raise GitHubIntegrationError("Could not load GitHub App user profile.")
    github_user_id = payload.get("id")
    login = payload.get("login")
    if not isinstance(github_user_id, (int, str)) or not isinstance(login, str) or not login:
        raise GitHubIntegrationError("Could not load GitHub App user profile.")
    avatar_url = payload.get("avatar_url")
    display_name = payload.get("name")
    return GitHubAppUserProfile(
        github_user_id=str(github_user_id),
        profile=GitHubUserProfile(
            login=login,
            avatar_url=avatar_url.strip()
            if isinstance(avatar_url, str) and avatar_url.strip()
            else None,
            display_name=display_name.strip()
            if isinstance(display_name, str) and display_name.strip()
            else None,
        ),
    )
