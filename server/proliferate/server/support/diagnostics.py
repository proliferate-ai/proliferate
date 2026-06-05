"""Server-owned support cloud diagnostics collection."""

from __future__ import annotations

import logging
from dataclasses import asdict, is_dataclass
from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.db.engine import async_session_factory
from proliferate.db.store import support_diagnostics as diagnostics_store
from proliferate.db.store import support_reports
from proliferate.db.store import support_session_diagnostics as session_diagnostics_store
from proliferate.integrations.aws import AwsIntegrationError, put_json_object
from proliferate.middleware.request_context import with_correlation_context
from proliferate.server.support.redaction import redact_mapping, redact_support_text

logger = logging.getLogger(__name__)

MAX_CLOUD_WORKSPACES = 5
MAX_TARGETS = 5
MAX_SESSIONS = 10
MAX_COMMANDS = 50
MAX_EVENTS_PER_SESSION = 100
MAX_TRANSCRIPT_ITEMS_PER_SESSION = 100
MAX_PENDING_INTERACTIONS = 50
MAX_SETUP_RUNS = 10


async def collect_cloud_diagnostics_for_report(report_id: str) -> None:
    try:
        await _collect_cloud_diagnostics_for_report(report_id)
    except Exception:
        logger.exception(
            "Support cloud diagnostics collection failed.",
            extra={"support_report_id": report_id},
        )
        async with async_session_factory() as db, db.begin():
            await support_reports.mark_cloud_diagnostics_status(
                db,
                report_id=report_id,
                status="failed",
                error="Cloud diagnostics collection failed.",
            )


async def _collect_cloud_diagnostics_for_report(report_id: str) -> None:
    async with async_session_factory() as db, db.begin():
        report = await support_reports.get_report_by_id(db, report_id)
        if report is None or report.cloud_diagnostics_status == "not_applicable":
            return
        with with_correlation_context(
            support_report_id=report.id,
            user_id=report.owner_user_id,
            tenant_id=report.primary_tenant_id,
        ):
            await support_reports.mark_cloud_diagnostics_status(
                db,
                report_id=report_id,
                status="running",
            )

    async with async_session_factory() as db, db.begin():
        report = await support_reports.get_report_by_id(db, report_id)
        if report is None:
            return
        with with_correlation_context(
            support_report_id=report.id,
            user_id=report.owner_user_id,
            tenant_id=report.primary_tenant_id,
        ):
            payload = await build_cloud_diagnostics_payload(db, report)
            if not payload["workspaces"]:
                await support_reports.mark_cloud_diagnostics_status(
                    db,
                    report_id=report_id,
                    status="skipped",
                    error="No authorized cloud workspace references were available.",
                )
                return

    with with_correlation_context(
        support_report_id=report.id,
        user_id=report.owner_user_id,
        tenant_id=report.primary_tenant_id,
    ):
        try:
            await put_json_object(
                bucket=report.s3_bucket,
                key=f"{report.s3_prefix}/cloud-diagnostics.json",
                value=payload,
                region_name=_support_report_region(),
            )
        except AwsIntegrationError:
            async with async_session_factory() as db, db.begin():
                await support_reports.mark_cloud_diagnostics_status(
                    db,
                    report_id=report_id,
                    status="failed",
                    error="Could not write cloud diagnostics to S3.",
                )
            raise

        async with async_session_factory() as db, db.begin():
            await support_reports.mark_cloud_diagnostics_status(
                db,
                report_id=report_id,
                status="completed",
            )


async def build_cloud_diagnostics_payload(
    db: AsyncSession,
    report: support_reports.SupportReportSnapshot,
) -> dict[str, object]:
    requested_ids = _cloud_workspace_ids_from_refs(report.workspace_refs)
    workspaces = await diagnostics_store.list_authorized_cloud_workspaces(
        db,
        user_id=report.owner_user_id,
        workspace_ids=requested_ids,
        limit=MAX_CLOUD_WORKSPACES,
    )
    workspace_ids = tuple(workspace.id for workspace in workspaces)
    target_ids = tuple(
        item for item in {workspace.target_id for workspace in workspaces if workspace.target_id}
    )[:MAX_TARGETS]

    exposures = await diagnostics_store.list_exposures_for_workspaces(db, workspace_ids)
    targets = await diagnostics_store.list_targets_for_ids(db, target_ids, limit=MAX_TARGETS)
    runtime_access = await diagnostics_store.list_runtime_access_for_targets(db, target_ids)
    sandbox_ids = tuple(
        item
        for item in {
            access.cloud_sandbox_id for access in runtime_access if access.cloud_sandbox_id
        }
    )
    sandboxes = await diagnostics_store.list_sandboxes_for_ids(db, sandbox_ids)
    commands = await diagnostics_store.list_recent_commands_for_workspaces(
        db,
        workspace_ids,
        limit=MAX_COMMANDS,
    )
    sessions = await session_diagnostics_store.list_recent_sessions_for_workspaces(
        db,
        workspace_ids,
        limit=MAX_SESSIONS,
    )
    session_keys = tuple((session.target_id, session.session_id) for session in sessions)
    session_ids = tuple(session.session_id for session in sessions)
    events = await session_diagnostics_store.list_recent_events_for_sessions(
        db,
        session_keys,
        limit_per_session=MAX_EVENTS_PER_SESSION,
    )
    transcript_items = await session_diagnostics_store.list_recent_transcript_items_for_sessions(
        db,
        session_keys,
        limit_per_session=MAX_TRANSCRIPT_ITEMS_PER_SESSION,
    )
    pending_interactions = await session_diagnostics_store.list_pending_interactions_for_sessions(
        db,
        session_keys,
        limit=MAX_PENDING_INTERACTIONS,
    )
    ingest_states = await session_diagnostics_store.list_event_ingest_states_for_sessions(
        db, session_keys
    )
    setup_runs = await diagnostics_store.list_recent_setup_runs_for_workspaces(
        db,
        workspace_ids,
        limit=MAX_SETUP_RUNS,
    )

    inaccessible = sorted(str(item) for item in set(requested_ids).difference(workspace_ids))
    section_errors = (
        [
            {
                "section": "workspaces",
                "message": (
                    "Some requested cloud workspace references were unavailable or unauthorized."
                ),
                "count": len(inaccessible),
            }
        ]
        if inaccessible
        else []
    )

    runtime_tails = [
        {
            "targetId": str(target_id),
            "notCollectedReason": (
                "Runtime tail collection is disabled unless an already-running managed target "
                "can be proven reachable without wake."
            ),
        }
        for target_id in target_ids
    ]

    payload = {
        "schemaVersion": 1,
        "reportId": report.id,
        "requestId": report.request_id,
        "generatedAt": datetime.now(UTC).isoformat(),
        "normalizedIds": {
            "ownerUserId": str(report.owner_user_id),
            "primaryOrganizationId": (
                str(report.primary_organization_id) if report.primary_organization_id else None
            ),
            "primaryTenantId": report.primary_tenant_id,
            "tenantIds": list(report.tenant_ids),
            "cloudWorkspaceIds": [str(item) for item in workspace_ids],
            "cloudTargetIds": [str(item) for item in target_ids],
            "cloudSandboxIds": [str(item) for item in sandbox_ids],
            "sessionIds": list(session_ids),
        },
        "caps": {
            "cloudWorkspaces": MAX_CLOUD_WORKSPACES,
            "targets": MAX_TARGETS,
            "sessions": MAX_SESSIONS,
            "commands": MAX_COMMANDS,
            "eventsPerSession": MAX_EVENTS_PER_SESSION,
            "transcriptItemsPerSession": MAX_TRANSCRIPT_ITEMS_PER_SESSION,
            "pendingInteractions": MAX_PENDING_INTERACTIONS,
            "setupRuns": MAX_SETUP_RUNS,
            "runtimeCollectionBudgetSecondsPerTarget": 25,
            "targetMaxBytes": 4 * 1024 * 1024,
        },
        "truncation": {
            "requestedCloudWorkspaceCount": len(requested_ids),
            "authorizedCloudWorkspaceCount": len(workspace_ids),
        },
        "queryHints": {
            "supportReportId": report.id,
            "tenantIds": list(report.tenant_ids),
            "ownerUserId": str(report.owner_user_id),
            "cloudWorkspaceIds": [str(item) for item in workspace_ids],
            "cloudTargetIds": [str(item) for item in target_ids],
            "sessionIds": list(session_ids),
        },
        "workspaces": [_serialize(item) for item in workspaces],
        "exposures": [_serialize(item) for item in exposures],
        "targets": [_serialize(item) for item in targets],
        "runtimeAccess": [_serialize(item) for item in runtime_access],
        "sandboxes": [_serialize(item) for item in sandboxes],
        "commands": [_serialize(item) for item in commands],
        "sessions": [_serialize(item) for item in sessions],
        "events": [_serialize(item) for item in events],
        "transcriptItems": [_serialize(item) for item in transcript_items],
        "pendingInteractions": [_serialize(item) for item in pending_interactions],
        "eventIngestStates": [_serialize(item) for item in ingest_states],
        "setupRuns": [_serialize(item) for item in setup_runs],
        "runtimeTails": runtime_tails,
        "sectionErrors": section_errors,
    }
    return redact_mapping(payload)


def _cloud_workspace_ids_from_refs(
    refs: tuple[dict[str, object], ...],
) -> tuple[UUID, ...]:
    ids: list[UUID] = []
    for ref in refs:
        raw = ref.get("cloudWorkspaceId")
        if not isinstance(raw, str) and isinstance(ref.get("id"), str):
            raw_id = str(ref["id"])
            raw = raw_id.removeprefix("cloud:") if raw_id.startswith("cloud:") else None
        if not raw:
            continue
        try:
            ids.append(UUID(str(raw)))
        except ValueError:
            continue
    return tuple(dict.fromkeys(ids))


def _serialize(value: object) -> object:
    if is_dataclass(value):
        return _serialize(asdict(value))
    if isinstance(value, dict):
        return {key: _serialize(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_serialize(item) for item in value]
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, str):
        return redact_support_text(value)
    return value


def _support_report_region() -> str | None:
    region = settings.support_report_s3_region.strip()
    return region or None
