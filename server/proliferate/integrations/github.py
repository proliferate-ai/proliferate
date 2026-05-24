"""Typed GitHub adapter used by auth and cloud services."""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, NoReturn

import httpx


@dataclass(frozen=True)
class GitHubRepoBranches:
    default_branch: str
    branches: list[str]
    branch_heads_by_name: dict[str, str] = field(default_factory=dict)
    permission: str | None = None
    private: bool = False
    fork: bool = False
    archived: bool = False
    disabled: bool = False


@dataclass(frozen=True)
class GitHubRepositorySummary:
    owner: str
    name: str
    full_name: str
    default_branch: str | None
    private: bool
    fork: bool
    archived: bool
    disabled: bool
    html_url: str | None
    owner_avatar_url: str | None
    pushed_at: str | None
    updated_at: str | None
    permission: str | None


@dataclass(frozen=True)
class GitHubRepositoryPage:
    repositories: list[GitHubRepositorySummary]
    next_cursor: str | None


@dataclass(frozen=True)
class GitHubUserProfile:
    login: str
    avatar_url: str | None
    display_name: str | None


class GitHubIntegrationError(RuntimeError):
    pass


class GitHubRepoAccessRequired(GitHubIntegrationError):
    pass


class GitHubRateLimited(GitHubIntegrationError):
    def __init__(
        self,
        message: str,
        *,
        retry_after_seconds: int | None = None,
        rate_limit_reset_at: str | None = None,
    ) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds
        self.rate_limit_reset_at = rate_limit_reset_at


class GitHubRepoEmpty(GitHubIntegrationError):
    pass


class GitHubInvalidCursor(GitHubIntegrationError):
    pass


def _github_headers(access_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _parse_retry_after_seconds(response: httpx.Response) -> int | None:
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        parsed = int(value)
    except ValueError:
        return None
    return parsed if parsed >= 0 else None


def _parse_rate_limit_reset_at(response: httpx.Response) -> str | None:
    value = response.headers.get("x-ratelimit-reset")
    if value is None:
        return None
    try:
        timestamp = int(value)
    except ValueError:
        return None
    return datetime.fromtimestamp(timestamp, tz=UTC).isoformat()


def _is_rate_limited_response(response: httpx.Response) -> bool:
    if response.status_code == 429:
        return True
    if response.status_code != 403:
        return False
    if response.headers.get("x-ratelimit-remaining") == "0":
        return True
    return response.headers.get("retry-after") is not None


def _raise_github_response_error(
    response: httpx.Response,
    *,
    access_message: str,
    fallback_message: str,
) -> NoReturn:
    if _is_rate_limited_response(response):
        raise GitHubRateLimited(
            "GitHub is rate limiting repository access. Try again later.",
            retry_after_seconds=_parse_retry_after_seconds(response),
            rate_limit_reset_at=_parse_rate_limit_reset_at(response),
        )
    if response.status_code in {401, 403, 404}:
        raise GitHubRepoAccessRequired(access_message)
    raise GitHubIntegrationError(fallback_message)


def _json_payload(response: httpx.Response) -> object:
    try:
        return response.json()
    except ValueError as exc:
        raise GitHubIntegrationError("GitHub returned an invalid response.") from exc


def _permission_from_payload(payload: dict[str, Any]) -> str | None:
    permissions = payload.get("permissions")
    if not isinstance(permissions, dict):
        return None
    for permission in ("admin", "maintain", "push", "triage", "pull"):
        if permissions.get(permission) is True:
            return permission
    return None


def _repo_summary_from_payload(payload: dict[str, Any]) -> GitHubRepositorySummary | None:
    owner_payload = payload.get("owner")
    if not isinstance(owner_payload, dict):
        return None
    owner = owner_payload.get("login")
    name = payload.get("name")
    if not isinstance(owner, str) or not owner.strip():
        return None
    if not isinstance(name, str) or not name.strip():
        return None
    full_name = payload.get("full_name")
    default_branch = payload.get("default_branch")
    html_url = payload.get("html_url")
    owner_avatar_url = owner_payload.get("avatar_url")
    pushed_at = payload.get("pushed_at")
    updated_at = payload.get("updated_at")
    return GitHubRepositorySummary(
        owner=owner.strip(),
        name=name.strip(),
        full_name=full_name.strip()
        if isinstance(full_name, str) and full_name.strip()
        else f"{owner.strip()}/{name.strip()}",
        default_branch=default_branch.strip()
        if isinstance(default_branch, str) and default_branch.strip()
        else None,
        private=payload.get("private") is True,
        fork=payload.get("fork") is True,
        archived=payload.get("archived") is True,
        disabled=payload.get("disabled") is True,
        html_url=html_url.strip() if isinstance(html_url, str) and html_url.strip() else None,
        owner_avatar_url=owner_avatar_url.strip()
        if isinstance(owner_avatar_url, str) and owner_avatar_url.strip()
        else None,
        pushed_at=pushed_at.strip() if isinstance(pushed_at, str) and pushed_at.strip() else None,
        updated_at=(
            updated_at.strip() if isinstance(updated_at, str) and updated_at.strip() else None
        ),
        permission=_permission_from_payload(payload),
    )


def _encode_repo_cursor(
    *,
    page: int,
    limit: int,
    affiliation: str,
    visibility: str,
    sort: str,
    direction: str,
) -> str:
    payload = {
        "source": "github-user-repos-v1",
        "page": page,
        "limit": limit,
        "affiliation": affiliation,
        "visibility": visibility,
        "sort": sort,
        "direction": direction,
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _decode_repo_cursor(
    cursor: str,
    *,
    limit: int,
    affiliation: str,
    visibility: str,
    sort: str,
    direction: str,
) -> int:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise GitHubInvalidCursor("Invalid GitHub repository cursor.") from exc
    if not isinstance(payload, dict):
        raise GitHubInvalidCursor("Invalid GitHub repository cursor.")
    expected = {
        "source": "github-user-repos-v1",
        "limit": limit,
        "affiliation": affiliation,
        "visibility": visibility,
        "sort": sort,
        "direction": direction,
    }
    if any(payload.get(key) != value for key, value in expected.items()):
        raise GitHubInvalidCursor("GitHub repository cursor does not match this request.")
    page = payload.get("page")
    if not isinstance(page, int) or page < 1:
        raise GitHubInvalidCursor("Invalid GitHub repository cursor.")
    return page


_NEXT_LINK_RE = re.compile(r'<[^>]*[?&]page=(\d+)[^>]*>;\s*rel="next"')


def _next_page_from_link_header(response: httpx.Response) -> int | None:
    link_header = response.headers.get("link")
    if not link_header:
        return None
    match = _NEXT_LINK_RE.search(link_header)
    if match is None:
        return None
    try:
        page = int(match.group(1))
    except ValueError:
        return None
    return page if page >= 1 else None


async def _fetch_github_repo_response(
    access_token: str,
    git_owner: str,
    git_repo_name: str,
) -> dict[str, Any]:
    repo_url = f"https://api.github.com/repos/{git_owner}/{git_repo_name}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(repo_url, headers=_github_headers(access_token))
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError(
            "Could not verify GitHub repository access for this cloud workspace."
        ) from exc

    if response.status_code < 300:
        payload = _json_payload(response)
        if isinstance(payload, dict):
            return payload
        raise GitHubIntegrationError(
            "Could not verify GitHub repository access for this cloud workspace."
        )

    _raise_github_response_error(
        response,
        access_message=(
            "Reconnect GitHub and grant repository access before creating a cloud workspace."
        ),
        fallback_message="Could not verify GitHub repository access for this cloud workspace.",
    )


async def list_github_repositories(
    access_token: str,
    *,
    cursor: str | None,
    limit: int,
    affiliation: str,
    visibility: str,
) -> GitHubRepositoryPage:
    sort = "pushed"
    direction = "desc"
    page = (
        _decode_repo_cursor(
            cursor,
            limit=limit,
            affiliation=affiliation,
            visibility=visibility,
            sort=sort,
            direction=direction,
        )
        if cursor
        else 1
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.github.com/user/repos",
                headers=_github_headers(access_token),
                params={
                    "per_page": limit,
                    "page": page,
                    "affiliation": affiliation,
                    "visibility": visibility,
                    "sort": sort,
                    "direction": direction,
                },
            )
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError("Could not list GitHub repositories.") from exc

    if response.status_code >= 300:
        _raise_github_response_error(
            response,
            access_message="Reconnect GitHub and grant repository access before browsing repos.",
            fallback_message="Could not list GitHub repositories.",
        )

    payload = _json_payload(response)
    if not isinstance(payload, list):
        raise GitHubIntegrationError("Could not list GitHub repositories.")

    repositories: list[GitHubRepositorySummary] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        summary = _repo_summary_from_payload(item)
        if summary is not None:
            repositories.append(summary)

    next_page = _next_page_from_link_header(response)
    next_cursor = (
        _encode_repo_cursor(
            page=next_page,
            limit=limit,
            affiliation=affiliation,
            visibility=visibility,
            sort=sort,
            direction=direction,
        )
        if next_page is not None
        else None
    )
    return GitHubRepositoryPage(repositories=repositories, next_cursor=next_cursor)


async def get_github_repo_branches(
    access_token: str,
    git_owner: str,
    git_repo_name: str,
) -> GitHubRepoBranches:
    repo_payload = await _fetch_github_repo_response(access_token, git_owner, git_repo_name)
    default_branch_payload = repo_payload.get("default_branch")
    default_branch = (
        default_branch_payload.strip()
        if isinstance(default_branch_payload, str) and default_branch_payload.strip()
        else None
    )
    repo_url = f"https://api.github.com/repos/{git_owner}/{git_repo_name}/branches"
    branches: list[str] = []
    branch_heads_by_name: dict[str, str] = {}

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            page = 1
            while True:
                response = await client.get(
                    repo_url,
                    headers=_github_headers(access_token),
                    params={"per_page": 100, "page": page},
                )
                if response.status_code >= 300:
                    _raise_github_response_error(
                        response,
                        access_message=(
                            "Reconnect GitHub and grant repository access"
                            " before creating a cloud workspace."
                        ),
                        fallback_message="Could not load GitHub branches for this repository.",
                    )

                payload = _json_payload(response)
                if not isinstance(payload, list):
                    raise GitHubIntegrationError(
                        "Could not load GitHub branches for this repository."
                    )

                for item in payload:
                    if not isinstance(item, dict):
                        continue
                    branch_name = item.get("name")
                    if not isinstance(branch_name, str):
                        continue
                    branches.append(branch_name)
                    commit = item.get("commit")
                    if isinstance(commit, dict):
                        commit_sha = commit.get("sha")
                        if isinstance(commit_sha, str) and commit_sha.strip():
                            branch_heads_by_name[branch_name] = commit_sha.strip()
                if len(payload) < 100:
                    break
                page += 1
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError(
            "Could not load GitHub branches for this repository."
        ) from exc

    ordered = sorted(set(branches))
    if not ordered or default_branch is None:
        raise GitHubRepoEmpty("This repository does not have a branch yet.")
    if default_branch in ordered:
        ordered.remove(default_branch)
    ordered.insert(0, default_branch)
    return GitHubRepoBranches(
        default_branch=default_branch,
        branches=ordered,
        branch_heads_by_name=branch_heads_by_name,
        permission=_permission_from_payload(repo_payload),
        private=repo_payload.get("private") is True,
        fork=repo_payload.get("fork") is True,
        archived=repo_payload.get("archived") is True,
        disabled=repo_payload.get("disabled") is True,
    )


# Public alias used by cloud repos service.
list_branches = get_github_repo_branches


async def get_github_user_profile(access_token: str) -> GitHubUserProfile:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.github.com/user",
                headers=_github_headers(access_token),
            )
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError("Could not load GitHub profile.") from exc

    if response.status_code >= 300:
        raise GitHubIntegrationError("Could not load GitHub profile.")

    try:
        payload = response.json()
    except ValueError as exc:
        raise GitHubIntegrationError("Could not load GitHub profile.") from exc

    if not isinstance(payload, dict):
        raise GitHubIntegrationError("Could not load GitHub profile.")

    login = payload.get("login")
    if not isinstance(login, str) or not login.strip():
        raise GitHubIntegrationError("Could not load GitHub profile.")

    avatar_url = payload.get("avatar_url")
    display_name = payload.get("name")
    return GitHubUserProfile(
        login=login.strip(),
        avatar_url=avatar_url.strip()
        if isinstance(avatar_url, str) and avatar_url.strip()
        else None,
        display_name=display_name.strip()
        if isinstance(display_name, str) and display_name.strip()
        else None,
    )
