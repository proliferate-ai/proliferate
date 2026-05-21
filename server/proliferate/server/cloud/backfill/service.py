"""Application service for worker backfill."""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.billing import (
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.db.store.cloud_sync import backfill as backfill_store
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.backfill.models import (
    WorkerBackfillRequest,
    WorkerBackfillResponse,
    WorkerBackfillSessionMapping,
    WorkerBackfillWorkspace,
    WorkerBackfillWorkspaceMapping,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.worker.domain.rules import compact_json
from proliferate.server.cloud.worker.domain.types import WorkerAuthContext
from proliferate.server.cloud.worker.slot_guard import require_current_managed_worker_slot

CLOUD_BACKFILL_TEMPLATE_VERSION = "worker-backfill-v1"
CLOUD_BACKFILL_ORIGIN_JSON = '{"kind":"system","entrypoint":"cloud"}'


@dataclass(frozen=True)
class NormalizedBackfillRepo:
    provider: str
    owner: str
    name: str
    branch: str
    base_branch: str


async def record_worker_backfill(
    db: AsyncSession,
    *,
    auth: WorkerAuthContext,
    body: WorkerBackfillRequest,
) -> WorkerBackfillResponse:
    target = await targets_store.get_target_by_id(db, auth.target_id)
    if target is None:
        raise CloudApiError(
            "cloud_worker_target_missing",
            "Worker target no longer exists.",
            status_code=401,
        )
    await require_current_managed_worker_slot(db, auth=auth, target=target)
    billing_subject = (
        await ensure_organization_billing_subject(db, target.organization_id)
        if target.owner_scope == "organization" and target.organization_id is not None
        else await ensure_personal_billing_subject(db, target.owner_user_id)
    )
    workspace_mappings: dict[str, UUID] = {}
    mapped_workspaces: list[WorkerBackfillWorkspaceMapping] = []
    for workspace in body.workspaces:
        repo = _normalize_repo(workspace)
        mapped = await backfill_store.upsert_synced_workspace(
            db,
            target_id=auth.target_id,
            anyharness_workspace_id=workspace.workspace_id,
            billing_subject_id=billing_subject.id,
            owner_scope=target.owner_scope,
            owner_user_id=target.owner_user_id,
            organization_id=target.organization_id,
            created_by_user_id=target.created_by_user_id,
            display_name=workspace.display_name,
            git_provider=repo.provider,
            git_owner=repo.owner,
            git_repo_name=repo.name,
            git_branch=repo.branch,
            git_base_branch=repo.base_branch,
            origin_json=CLOUD_BACKFILL_ORIGIN_JSON,
            template_version=CLOUD_BACKFILL_TEMPLATE_VERSION,
        )
        workspace_mappings[workspace.workspace_id] = mapped.id
        mapped_workspaces.append(
            WorkerBackfillWorkspaceMapping(
                workspace_id=workspace.workspace_id,
                cloud_workspace_id=str(mapped.id),
            )
        )

    mapped_sessions: list[WorkerBackfillSessionMapping] = []
    for session in body.sessions:
        cloud_workspace_id = workspace_mappings.get(session.workspace_id or "")
        if cloud_workspace_id is None:
            cloud_workspace_id = await events_store.resolve_cloud_workspace_id(
                db,
                target_id=auth.target_id,
                workspace_id=session.workspace_id,
            )
        projection = await events_store.upsert_session_projection(
            db,
            target_id=auth.target_id,
            cloud_workspace_id=cloud_workspace_id,
            workspace_id=session.workspace_id,
            session_id=session.session_id,
            seq=max(0, session.last_event_seq),
            occurred_at=session.last_event_at,
            status=session.status,
            phase=session.phase,
            native_session_id=session.native_session_id,
            source_agent_kind=session.source_agent_kind,
            title=session.title,
            live_config_json=compact_json(session.live_config),
            started_at=session.started_at,
            ended_at=session.ended_at,
        )
        for interaction in session.pending_interactions:
            await events_store.upsert_pending_interaction(
                db,
                target_id=auth.target_id,
                cloud_workspace_id=cloud_workspace_id,
                workspace_id=session.workspace_id,
                session_id=session.session_id,
                request_id=interaction.request_id,
                seq=max(0, session.last_event_seq),
                occurred_at=session.last_event_at,
                kind=interaction.kind,
                title=interaction.title,
                description=interaction.description,
                payload_json=compact_json(interaction.payload),
            )
        await events_store.resolve_missing_pending_interactions(
            db,
            target_id=auth.target_id,
            session_id=session.session_id,
            active_request_ids=tuple(
                interaction.request_id for interaction in session.pending_interactions
            ),
            seq=max(0, session.last_event_seq),
            occurred_at=session.last_event_at,
        )
        mapped_sessions.append(
            WorkerBackfillSessionMapping(
                session_id=session.session_id,
                workspace_id=session.workspace_id,
                cloud_workspace_id=(
                    str(projection.cloud_workspace_id)
                    if projection.cloud_workspace_id is not None
                    else None
                ),
            )
        )
    return WorkerBackfillResponse(
        mapped_workspaces=mapped_workspaces,
        mapped_sessions=mapped_sessions,
    )


def _normalize_repo(workspace: WorkerBackfillWorkspace) -> NormalizedBackfillRepo:
    repo = workspace.repo
    provider = _clean(repo.provider if repo is not None else None) or "local"
    owner = _clean(repo.owner if repo is not None else None) or "target"
    name = (
        _clean(repo.name if repo is not None else None)
        or _clean(workspace.display_name)
        or _last_path_segment(workspace.path)
        or workspace.workspace_id
    )
    branch = _clean(repo.branch if repo is not None else None) or "default"
    base_branch = _clean(repo.base_branch if repo is not None else None) or branch
    return NormalizedBackfillRepo(
        provider=provider[:32],
        owner=owner[:255],
        name=name[:255],
        branch=branch[:255],
        base_branch=base_branch[:255],
    )


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _last_path_segment(value: str | None) -> str | None:
    cleaned = _clean(value)
    if cleaned is None:
        return None
    return cleaned.rstrip("/").rsplit("/", 1)[-1] or None
