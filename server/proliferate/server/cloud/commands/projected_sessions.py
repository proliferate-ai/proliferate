"""Projected-session command workspace resolution."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import ActorIdentity
from proliferate.constants.cloud import CloudCommandKind
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import targets as targets_store
from proliferate.server.cloud.claims.access import require_workspace_interact
from proliferate.server.cloud.commands.models import CreateCloudCommandRequest
from proliferate.server.cloud.errors import CloudApiError

PROJECTED_SESSION_COMMAND_KINDS = {
    CloudCommandKind.send_prompt.value,
    CloudCommandKind.decide_plan.value,
    CloudCommandKind.resolve_interaction.value,
    CloudCommandKind.update_session_config.value,
    CloudCommandKind.cancel_turn.value,
    CloudCommandKind.close_session.value,
}


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None


async def resolve_projected_session_command_workspace(
    db: AsyncSession,
    *,
    user: ActorIdentity,
    target: targets_store.CloudTargetSnapshot,
    body: CreateCloudCommandRequest,
) -> tuple[str | None, dict[str, object], str | None]:
    if not body.session_id:
        raise CloudApiError(
            "cloud_command_session_required",
            "Projected session commands require sessionId.",
            status_code=400,
        )
    projection = await events_store.get_session_projection(
        db,
        target_id=target.id,
        session_id=body.session_id,
    )
    if projection is None or projection.cloud_workspace_id is None:
        raise CloudApiError(
            "cloud_command_session_not_projected",
            "Session is not projected into Cloud.",
            status_code=409,
        )
    if (
        body.cloud_workspace_id is not None
        and body.cloud_workspace_id != projection.cloud_workspace_id
    ):
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Session is not attached to the requested Cloud workspace.",
            status_code=409,
        )
    exposure = None
    if projection.exposure_id is not None:
        exposure = await exposures_store.get_workspace_exposure_by_id(
            db,
            projection.exposure_id,
        )
    if exposure is None and projection.cloud_workspace_id is not None:
        exposure = await exposures_store.get_active_workspace_exposure(
            db,
            target_id=target.id,
            cloud_workspace_id=projection.cloud_workspace_id,
        )
    if exposure is None or exposure.archived_at is not None or exposure.status != "active":
        raise CloudApiError(
            "cloud_command_exposure_not_active",
            "Session is not exposed for Cloud commands.",
            status_code=409,
        )
    if not exposure.commandable or not projection.commandable:
        raise CloudApiError(
            "cloud_command_exposure_not_commandable",
            "Session exposure is read-only.",
            status_code=409,
        )
    await require_workspace_interact(
        db,
        actor_user_id=user.id,
        owner_scope=exposure.owner_scope,
        owner_user_id=exposure.owner_user_id,
        organization_id=exposure.organization_id,
        workspace_archived=False,
        exposure=exposure,
    )
    if body.kind == CloudCommandKind.decide_plan.value:
        resolved_workspace_id = projection.workspace_id or exposure.anyharness_workspace_id
    else:
        resolved_workspace_id = (
            projection.workspace_id or exposure.anyharness_workspace_id or body.workspace_id
        )
    if (
        body.workspace_id is not None
        and resolved_workspace_id is not None
        and body.workspace_id != resolved_workspace_id
    ):
        raise CloudApiError(
            "cloud_command_workspace_target_mismatch",
            "Session is not attached to the requested runtime workspace.",
            status_code=409,
        )
    payload = body.payload
    if body.kind == CloudCommandKind.decide_plan.value:
        if resolved_workspace_id is None:
            raise CloudApiError(
                "cloud_command_workspace_required",
                "Projected plan decisions require a runtime workspace id.",
                status_code=409,
            )
        payload = dict(body.payload)
        payload_workspace_id = _str_or_none(payload.get("workspaceId"))
        if payload_workspace_id is not None and payload_workspace_id != resolved_workspace_id:
            raise CloudApiError(
                "cloud_command_workspace_target_mismatch",
                "Plan decision workspace does not match the projected session workspace.",
                status_code=409,
            )
        payload["workspaceId"] = resolved_workspace_id
    return (
        resolved_workspace_id,
        payload,
        str(projection.cloud_workspace_id),
    )
