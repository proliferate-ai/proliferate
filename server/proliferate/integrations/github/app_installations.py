"""GitHub App installation and repository coverage helpers."""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from jose import jwt

from proliferate.config import settings
from proliferate.integrations.github.repos import GitHubIntegrationError


class GitHubWebhookSignatureError(GitHubIntegrationError):
    pass


@dataclass(frozen=True)
class GitHubAppInstallationInfo:
    github_installation_id: str
    account_login: str
    account_type: str
    repository_selection: str
    permissions: dict[str, object]
    suspended_at: datetime | None = None


@dataclass(frozen=True)
class GitHubAppRepositoryCoverage:
    covered: bool
    repository_id: str | None
    private: bool | None = None
    default_branch: str | None = None


def github_app_private_key() -> str:
    inline = settings.github_app_private_key.strip()
    if inline:
        return inline.replace("\\n", "\n")
    path = settings.github_app_private_key_path.strip()
    if path:
        return Path(path).read_text(encoding="utf-8")
    raise GitHubIntegrationError("GitHub App private key is not configured.")


def create_github_app_jwt() -> str:
    app_id = settings.github_app_id.strip()
    if not app_id:
        raise GitHubIntegrationError("GitHub App ID is not configured.")
    now = datetime.now(UTC)
    return jwt.encode(
        {
            "iat": int((now - timedelta(seconds=30)).timestamp()),
            "exp": int((now + timedelta(minutes=9)).timestamp()),
            "iss": app_id,
        },
        github_app_private_key(),
        algorithm="RS256",
    )


def _app_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {create_github_app_jwt()}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _user_headers(access_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _parse_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _installation_from_payload(payload: dict[str, Any]) -> GitHubAppInstallationInfo | None:
    account = payload.get("account")
    if not isinstance(account, dict):
        return None
    installation_id = payload.get("id")
    account_login = account.get("login")
    account_type = account.get("type")
    repository_selection = payload.get("repository_selection")
    permissions = payload.get("permissions")
    if (
        not isinstance(installation_id, (int, str))
        or not isinstance(account_login, str)
        or not account_login.strip()
        or not isinstance(account_type, str)
        or not isinstance(repository_selection, str)
    ):
        return None
    return GitHubAppInstallationInfo(
        github_installation_id=str(installation_id),
        account_login=account_login.strip(),
        account_type=account_type.strip() or "User",
        repository_selection=repository_selection.strip() or "selected",
        permissions=permissions if isinstance(permissions, dict) else {},
        suspended_at=_parse_time(payload.get("suspended_at")),
    )


async def list_github_app_installations() -> tuple[GitHubAppInstallationInfo, ...]:
    installations: list[GitHubAppInstallationInfo] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            page = 1
            while True:
                response = await client.get(
                    "https://api.github.com/app/installations",
                    headers=_app_headers(),
                    params={"per_page": 100, "page": page},
                )
                if response.status_code >= 300:
                    raise GitHubIntegrationError("Could not list GitHub App installations.")
                payload = response.json()
                if not isinstance(payload, list):
                    raise GitHubIntegrationError("Could not list GitHub App installations.")
                for item in payload:
                    if isinstance(item, dict):
                        installation = _installation_from_payload(item)
                        if installation is not None:
                            installations.append(installation)
                if len(payload) < 100:
                    break
                page += 1
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError("Could not list GitHub App installations.") from exc
    return tuple(installations)


async def fetch_installation_repo_coverage_from_github(
    *,
    user_access_token: str,
    installation_id: str,
    git_owner: str,
    git_repo_name: str,
) -> GitHubAppRepositoryCoverage:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            page = 1
            while True:
                response = await client.get(
                    f"https://api.github.com/user/installations/{installation_id}/repositories",
                    headers=_user_headers(user_access_token),
                    params={"per_page": 100, "page": page},
                )
                coverage, page_complete = _coverage_from_installation_repo_response(
                    response,
                    git_owner=git_owner,
                    git_repo_name=git_repo_name,
                )
                if coverage.covered or page_complete:
                    return coverage
                page += 1
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError("Could not verify GitHub App repository coverage.") from exc


def _coverage_from_installation_repo_response(
    response: httpx.Response,
    *,
    git_owner: str,
    git_repo_name: str,
) -> tuple[GitHubAppRepositoryCoverage, bool]:
    if response.status_code in {401, 403, 404}:
        return GitHubAppRepositoryCoverage(covered=False, repository_id=None), True
    if response.status_code >= 300:
        raise GitHubIntegrationError("Could not verify GitHub App repository coverage.")
    try:
        payload = response.json()
    except ValueError as exc:
        raise GitHubIntegrationError("Could not verify GitHub App repository coverage.") from exc
    repositories = payload.get("repositories") if isinstance(payload, dict) else None
    if not isinstance(repositories, list):
        raise GitHubIntegrationError("Could not verify GitHub App repository coverage.")
    page_complete = len(repositories) < 100
    expected = f"{git_owner}/{git_repo_name}".lower()
    for repo in repositories:
        if not isinstance(repo, dict):
            continue
        full_name = repo.get("full_name")
        if not isinstance(full_name, str) or full_name.lower() != expected:
            continue
        repo_id = repo.get("id")
        return GitHubAppRepositoryCoverage(
            covered=True,
            repository_id=str(repo_id) if isinstance(repo_id, (int, str)) else None,
            private=repo.get("private") is True,
            default_branch=repo.get("default_branch")
            if isinstance(repo.get("default_branch"), str)
            else None,
        ), page_complete
    return GitHubAppRepositoryCoverage(covered=False, repository_id=None), page_complete


async def verify_github_app_user_repo_access(
    *,
    user_access_token: str,
    git_owner: str,
    git_repo_name: str,
) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"https://api.github.com/repos/{git_owner}/{git_repo_name}",
                headers=_user_headers(user_access_token),
            )
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError(
            "Could not verify GitHub App user repository access."
        ) from exc
    return response.status_code < 300


def verify_github_webhook_signature(
    *,
    payload: bytes,
    signature: str | None,
    secret: str,
) -> None:
    if not secret.strip():
        raise GitHubWebhookSignatureError("GitHub App webhook secret is not configured.")
    if not signature or not signature.startswith("sha256="):
        raise GitHubWebhookSignatureError("GitHub App webhook signature is missing.")
    expected = hmac.digest(secret.encode("utf-8"), payload, "sha256").hex()
    supplied = signature.removeprefix("sha256=")
    if not hmac.compare_digest(expected, supplied):
        raise GitHubWebhookSignatureError("GitHub App webhook signature is invalid.")
