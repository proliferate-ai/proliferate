"""Typed GitHub adapter used by auth and cloud services."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx


@dataclass(frozen=True)
class GitHubRepoBranches:
    default_branch: str
    branches: list[str]
    branch_heads_by_name: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class GitHubUserProfile:
    login: str
    avatar_url: str | None
    display_name: str | None


class GitHubIntegrationError(RuntimeError):
    pass


class GitHubRepoAccessRequired(GitHubIntegrationError):
    pass


def _github_headers(access_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


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
        payload = response.json()
        if isinstance(payload, dict):
            return payload
        raise GitHubIntegrationError(
            "Could not verify GitHub repository access for this cloud workspace."
        )

    if response.status_code in {401, 403, 404}:
        raise GitHubRepoAccessRequired(
            "Reconnect GitHub and grant repository access before creating a cloud workspace."
        )

    raise GitHubIntegrationError(
        "Could not verify GitHub repository access for this cloud workspace."
    )


async def get_github_repo_branches(
    access_token: str,
    git_owner: str,
    git_repo_name: str,
) -> GitHubRepoBranches:
    repo_payload = await _fetch_github_repo_response(access_token, git_owner, git_repo_name)
    default_branch = str(repo_payload.get("default_branch") or "main")
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
                if response.status_code in {401, 403, 404}:
                    raise GitHubRepoAccessRequired(
                        "Reconnect GitHub and grant repository access"
                        " before creating a cloud workspace."
                    )
                if response.status_code >= 300:
                    raise GitHubIntegrationError(
                        "Could not load GitHub branches for this repository."
                    )

                payload = response.json()
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
    if default_branch in ordered:
        ordered.remove(default_branch)
    ordered.insert(0, default_branch)
    return GitHubRepoBranches(
        default_branch=default_branch,
        branches=ordered,
        branch_heads_by_name=branch_heads_by_name,
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
