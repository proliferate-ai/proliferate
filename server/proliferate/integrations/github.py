"""Typed GitHub adapter used by auth and cloud services."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class GitHubRepoBranches:
    default_branch: str
    branches: list[str]


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

                page_branches = [
                    item["name"]
                    for item in payload
                    if isinstance(item, dict) and isinstance(item.get("name"), str)
                ]
                branches.extend(page_branches)
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
    return GitHubRepoBranches(default_branch=default_branch, branches=ordered)


# Public alias used by cloud repos service.
list_branches = get_github_repo_branches
