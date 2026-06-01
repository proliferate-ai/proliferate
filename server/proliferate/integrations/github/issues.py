"""GitHub App issue helpers for support report tracking."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from jose import jwt

from proliferate.integrations.github.repos import GitHubIntegrationError


class GitHubIssueCreateAmbiguous(GitHubIntegrationError):
    pass


@dataclass(frozen=True)
class GitHubIssue:
    id: str
    number: int
    url: str
    body: str | None = None


def support_report_marker(report_id: str) -> str:
    return f"<!-- proliferate-support-report:{report_id} -->"


def support_report_search_token(report_id: str) -> str:
    return f"proliferate-support-report:{report_id}"


async def ensure_support_issue(
    *,
    app_id: str,
    private_key: str,
    installation_id: str,
    owner: str,
    repo: str,
    report_id: str,
    title: str,
    body: str,
    labels: tuple[str, ...],
) -> GitHubIssue:
    token = await create_installation_access_token(
        app_id=app_id,
        private_key=private_key,
        installation_id=installation_id,
    )
    existing = await find_support_issue(
        token=token,
        owner=owner,
        repo=repo,
        report_id=report_id,
        label=labels[0] if labels else None,
    )
    if existing is not None:
        if existing.body != body:
            return await update_issue_body(
                token=token,
                owner=owner,
                repo=repo,
                issue_number=existing.number,
                body=body,
            )
        return existing
    return await create_issue(
        token=token,
        owner=owner,
        repo=repo,
        title=title,
        body=body,
        labels=labels,
    )


async def create_installation_access_token(
    *,
    app_id: str,
    private_key: str,
    installation_id: str,
) -> str:
    now = datetime.now(UTC)
    normalized_private_key = private_key.replace("\\n", "\n")
    app_jwt = jwt.encode(
        {
            "iat": int((now - timedelta(seconds=30)).timestamp()),
            "exp": int((now + timedelta(minutes=9)).timestamp()),
            "iss": app_id,
        },
        normalized_private_key,
        algorithm="RS256",
    )
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"https://api.github.com/app/installations/{installation_id}/access_tokens",
                headers={
                    "Authorization": f"Bearer {app_jwt}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
            )
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError("Could not create GitHub App installation token.") from exc

    payload = _json_or_raise(response, "Could not create GitHub App installation token.")
    token = payload.get("token")
    if response.status_code >= 300 or not isinstance(token, str) or not token.strip():
        raise GitHubIntegrationError("Could not create GitHub App installation token.")
    return token.strip()


async def find_support_issue(
    *,
    token: str,
    owner: str,
    repo: str,
    report_id: str,
    label: str | None,
) -> GitHubIssue | None:
    found_by_search = await search_support_issue(
        token=token,
        owner=owner,
        repo=repo,
        report_id=report_id,
    )
    if found_by_search is not None:
        return found_by_search

    params: dict[str, object] = {
        "state": "all",
        "sort": "created",
        "direction": "desc",
        "per_page": 100,
    }
    if label:
        params["labels"] = label
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"https://api.github.com/repos/{owner}/{repo}/issues",
                headers=_headers(token),
                params=params,
            )
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError("Could not search GitHub support issues.") from exc

    payload = _json_or_raise(response, "Could not search GitHub support issues.")
    if response.status_code >= 300 or not isinstance(payload, list):
        raise GitHubIntegrationError("Could not search GitHub support issues.")
    marker = support_report_marker(report_id)
    for item in payload:
        if not isinstance(item, dict) or isinstance(item.get("pull_request"), dict):
            continue
        body = item.get("body")
        if isinstance(body, str) and marker in body:
            return _issue_from_payload(item)
    return None


async def search_support_issue(
    *,
    token: str,
    owner: str,
    repo: str,
    report_id: str,
) -> GitHubIssue | None:
    marker = support_report_marker(report_id)
    query = f'"{support_report_search_token(report_id)}" repo:{owner}/{repo} type:issue in:body'
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                "https://api.github.com/search/issues",
                headers=_headers(token),
                params={
                    "q": query,
                    "per_page": 10,
                },
            )
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError("Could not search GitHub support issues.") from exc

    payload = _json_or_raise(response, "Could not search GitHub support issues.")
    if response.status_code >= 300 or not isinstance(payload, dict):
        raise GitHubIntegrationError("Could not search GitHub support issues.")
    items = payload.get("items")
    if not isinstance(items, list):
        raise GitHubIntegrationError("Could not search GitHub support issues.")
    for item in items:
        if not isinstance(item, dict) or isinstance(item.get("pull_request"), dict):
            continue
        body = item.get("body")
        if isinstance(body, str) and marker in body:
            return _issue_from_payload(item)
    return None


async def create_issue(
    *,
    token: str,
    owner: str,
    repo: str,
    title: str,
    body: str,
    labels: tuple[str, ...],
) -> GitHubIssue:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"https://api.github.com/repos/{owner}/{repo}/issues",
                headers=_headers(token),
                json={
                    "title": title,
                    "body": body,
                    "labels": list(labels),
                },
            )
    except httpx.HTTPError as exc:
        raise GitHubIssueCreateAmbiguous("GitHub issue creation did not complete.") from exc

    payload = _json_or_raise(response, "Could not create GitHub support issue.")
    if response.status_code >= 500:
        raise GitHubIssueCreateAmbiguous("GitHub issue creation returned a retryable error.")
    if response.status_code >= 300 or not isinstance(payload, dict):
        raise GitHubIntegrationError("Could not create GitHub support issue.")
    return _issue_from_payload(payload)


async def update_issue_body(
    *,
    token: str,
    owner: str,
    repo: str,
    issue_number: int,
    body: str,
) -> GitHubIssue:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.patch(
                f"https://api.github.com/repos/{owner}/{repo}/issues/{issue_number}",
                headers=_headers(token),
                json={"body": body},
            )
    except httpx.HTTPError as exc:
        raise GitHubIntegrationError("Could not update GitHub support issue.") from exc

    payload = _json_or_raise(response, "Could not update GitHub support issue.")
    if response.status_code >= 300 or not isinstance(payload, dict):
        raise GitHubIntegrationError("Could not update GitHub support issue.")
    return _issue_from_payload(payload)


def _headers(token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }


def _json_or_raise(response: httpx.Response, message: str) -> Any:
    try:
        return response.json()
    except ValueError as exc:
        raise GitHubIntegrationError(message) from exc


def _issue_from_payload(payload: dict[str, Any]) -> GitHubIssue:
    issue_id = payload.get("id")
    number = payload.get("number")
    url = payload.get("html_url")
    if not isinstance(issue_id, (int, str)):
        raise GitHubIntegrationError("GitHub issue response was missing an ID.")
    if not isinstance(number, int):
        raise GitHubIntegrationError("GitHub issue response was missing a number.")
    if not isinstance(url, str) or not url.strip():
        raise GitHubIntegrationError("GitHub issue response was missing a URL.")
    body = payload.get("body")
    return GitHubIssue(
        id=str(issue_id),
        number=number,
        url=url.strip(),
        body=body if isinstance(body, str) else None,
    )
