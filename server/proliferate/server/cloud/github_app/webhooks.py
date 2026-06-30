"""GitHub App webhook processing."""

from __future__ import annotations

import json

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.store import github_app as github_app_store
from proliferate.integrations.github import (
    GitHubAppRepositoryCoverage,
    GitHubWebhookSignatureError,
    verify_github_webhook_signature,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.github_app.service import installation_info_from_webhook
from proliferate.utils.time import utcnow


async def handle_github_app_webhook(
    db: AsyncSession,
    *,
    payload: bytes,
    event: str | None,
    signature: str | None,
) -> None:
    try:
        verify_github_webhook_signature(
            payload=payload,
            signature=signature,
            secret=settings.github_app_webhook_secret,
        )
    except GitHubWebhookSignatureError as exc:
        raise CloudApiError("github_app_webhook_invalid", str(exc), status_code=401) from exc
    try:
        body = json.loads(payload.decode("utf-8"))
    except ValueError as exc:
        raise CloudApiError(
            "github_app_webhook_invalid",
            "GitHub App webhook payload is invalid.",
            status_code=400,
        ) from exc
    if not isinstance(body, dict):
        raise CloudApiError(
            "github_app_webhook_invalid",
            "GitHub App webhook payload is invalid.",
            status_code=400,
        )

    match event:
        case "installation":
            await _handle_installation_event(db, body)
        case "installation_repositories":
            await _handle_installation_repositories_event(db, body)
        case _:
            return


async def _handle_installation_event(db: AsyncSession, body: dict[str, object]) -> None:
    action = body.get("action")
    installation = installation_info_from_webhook(body)
    if installation is None:
        return
    if action == "deleted":
        await github_app_store.mark_github_app_installation_deleted(
            db,
            github_installation_id=installation.github_installation_id,
        )
        return
    value = await github_app_store.upsert_github_app_installation(db, installation=installation)
    if action in {"suspend", "suspended"}:
        await github_app_store.set_github_app_installation_suspended(
            db,
            github_installation_id=value.github_installation_id,
            suspended_at=utcnow(),
        )
    elif action in {"unsuspend", "unsuspended"}:
        await github_app_store.set_github_app_installation_suspended(
            db,
            github_installation_id=value.github_installation_id,
            suspended_at=None,
        )


async def _handle_installation_repositories_event(
    db: AsyncSession,
    body: dict[str, object],
) -> None:
    installation = installation_info_from_webhook(body)
    if installation is None:
        return
    value = await github_app_store.upsert_github_app_installation(db, installation=installation)
    action = body.get("action")
    added_key = "repositories_added" if action == "added" else "repositories_removed"
    repositories = body.get(added_key)
    if not isinstance(repositories, list):
        return
    for item in repositories:
        if not isinstance(item, dict):
            continue
        full_name = item.get("full_name")
        if not isinstance(full_name, str) or "/" not in full_name:
            continue
        owner, name = full_name.split("/", 1)
        if action == "removed":
            await github_app_store.delete_installation_repo_cache(
                db,
                installation_id=value.id,
                owner=owner,
                name=name,
            )
            continue
        repo_id = item.get("id")
        if not isinstance(repo_id, (int, str)):
            continue
        await github_app_store.upsert_installation_repo_cache(
            db,
            installation_id=value.id,
            owner=owner,
            name=name,
            coverage=GitHubAppRepositoryCoverage(
                covered=True,
                repository_id=str(repo_id),
                private=item.get("private") is True,
                default_branch=item.get("default_branch")
                if isinstance(item.get("default_branch"), str)
                else None,
            ),
        )
