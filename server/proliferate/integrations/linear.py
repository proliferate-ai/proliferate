"""Minimal Linear GraphQL adapter for support report tracking."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx


class LinearIntegrationError(RuntimeError):
    pass


class LinearIssueCreateAmbiguous(LinearIntegrationError):
    pass


@dataclass(frozen=True)
class LinearIssue:
    id: str
    identifier: str
    url: str
    description: str | None = None


def support_report_marker(report_id: str) -> str:
    return f"<!-- proliferate-support-report:{report_id} -->"


async def ensure_support_issue(
    *,
    api_key: str,
    team_id: str,
    project_id: str | None,
    label_ids: tuple[str, ...],
    report_id: str,
    title: str,
    description: str,
) -> LinearIssue:
    existing = await find_support_issue(
        api_key=api_key,
        report_id=report_id,
    )
    if existing is not None:
        if existing.description != description:
            return await update_issue_description(
                api_key=api_key,
                issue_id=existing.id,
                description=description,
            )
        return existing
    return await create_issue(
        api_key=api_key,
        team_id=team_id,
        project_id=project_id,
        label_ids=label_ids,
        title=title,
        description=description,
    )


async def find_support_issue(
    *,
    api_key: str,
    report_id: str,
) -> LinearIssue | None:
    marker = support_report_marker(report_id)
    payload = await _graphql(
        api_key=api_key,
        query="""
        query SupportIssueByMarker($marker: String!) {
          issues(filter: { description: { contains: $marker } }, first: 10) {
            nodes {
              id
              identifier
              url
              description
            }
          }
        }
        """,
        variables={"marker": marker},
    )
    nodes = (((payload.get("data") or {}).get("issues") or {}).get("nodes") or [])
    if not isinstance(nodes, list):
        raise LinearIntegrationError("Linear returned an invalid issue search response.")
    for item in nodes:
        if not isinstance(item, dict):
            continue
        description = item.get("description")
        if isinstance(description, str) and marker in description:
            return _issue_from_payload(item)
    return None


async def create_issue(
    *,
    api_key: str,
    team_id: str,
    project_id: str | None,
    label_ids: tuple[str, ...],
    title: str,
    description: str,
) -> LinearIssue:
    issue_input: dict[str, object] = {
        "teamId": team_id,
        "title": title,
        "description": description,
    }
    if project_id:
        issue_input["projectId"] = project_id
    if label_ids:
        issue_input["labelIds"] = list(label_ids)
    try:
        payload = await _graphql(
            api_key=api_key,
            query="""
            mutation CreateSupportIssue($input: IssueCreateInput!) {
              issueCreate(input: $input) {
                success
                issue {
                  id
                  identifier
                  url
                  description
                }
              }
            }
            """,
            variables={"input": issue_input},
        )
    except httpx.HTTPError as exc:
        raise LinearIssueCreateAmbiguous("Linear issue creation did not complete.") from exc

    result = ((payload.get("data") or {}).get("issueCreate") or {})
    if not isinstance(result, dict) or result.get("success") is not True:
        raise LinearIntegrationError("Could not create Linear support issue.")
    issue = result.get("issue")
    if not isinstance(issue, dict):
        raise LinearIntegrationError("Linear issue response was missing the issue.")
    return _issue_from_payload(issue)


async def update_issue_description(
    *,
    api_key: str,
    issue_id: str,
    description: str,
) -> LinearIssue:
    payload = await _graphql(
        api_key=api_key,
        query="""
        mutation UpdateSupportIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue {
              id
              identifier
              url
              description
            }
          }
        }
        """,
        variables={"id": issue_id, "input": {"description": description}},
    )
    result = ((payload.get("data") or {}).get("issueUpdate") or {})
    if not isinstance(result, dict) or result.get("success") is not True:
        raise LinearIntegrationError("Could not update Linear support issue.")
    issue = result.get("issue")
    if not isinstance(issue, dict):
        raise LinearIntegrationError("Linear issue response was missing the issue.")
    return _issue_from_payload(issue)


async def _graphql(
    *,
    api_key: str,
    query: str,
    variables: dict[str, object],
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.post(
            "https://api.linear.app/graphql",
            headers={
                "Authorization": api_key,
                "Content-Type": "application/json",
            },
            json={"query": query, "variables": variables},
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise LinearIntegrationError("Linear returned an invalid response.") from exc
    if response.status_code >= 500:
        raise LinearIssueCreateAmbiguous("Linear returned a retryable error.")
    if response.status_code >= 300:
        raise LinearIntegrationError("Linear request failed.")
    if not isinstance(payload, dict):
        raise LinearIntegrationError("Linear returned an invalid response.")
    errors = payload.get("errors")
    if errors:
        raise LinearIntegrationError("Linear returned GraphQL errors.")
    return payload


def _issue_from_payload(payload: dict[str, Any]) -> LinearIssue:
    issue_id = payload.get("id")
    identifier = payload.get("identifier")
    url = payload.get("url")
    if not isinstance(issue_id, str) or not issue_id.strip():
        raise LinearIntegrationError("Linear issue response was missing an ID.")
    if not isinstance(identifier, str) or not identifier.strip():
        raise LinearIntegrationError("Linear issue response was missing an identifier.")
    if not isinstance(url, str) or not url.strip():
        raise LinearIntegrationError("Linear issue response was missing a URL.")
    description = payload.get("description")
    return LinearIssue(
        id=issue_id.strip(),
        identifier=identifier.strip(),
        url=url.strip(),
        description=description if isinstance(description, str) else None,
    )
