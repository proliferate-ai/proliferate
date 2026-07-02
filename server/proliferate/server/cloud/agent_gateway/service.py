"""Agent gateway auth services: key pool, route selections, capabilities.

Store legality errors surface as typed :class:`CloudApiError` values so the
API layer maps them uniformly. Key create/revoke and selection changes emit
structured audit log events (the Bifrost-era audit table was dropped; the
cloud event log is the post-teardown audit surface).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_API_KEY_PROVIDERS,
    AGENT_AUTH_ROUTES,
    AGENT_AUTH_SLOT_PRIMARY,
    AGENT_AUTH_SURFACE_CLOUD,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import (
    AgentApiKeyRecord,
    AgentAuthRouteSelectionRecord,
    AgentGatewayEnrollmentRecord,
    OrgMemberRouteSelectionRecord,
)
from proliferate.db.store.billing import list_entitlements
from proliferate.db.store.billing_subscriptions import list_subscriptions
from proliferate.server.billing.domain.plans import (
    active_unlimited_cloud_entitlement,
    latest_healthy_cloud_subscription,
)
from proliferate.server.billing.snapshots import billing_plan_rule_config
from proliferate.server.billing.subjects import ensure_organization_billing_subject_state
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.server.cloud.materialization.materialize.agent_auth import (
    build_agent_auth_state,
)
from proliferate.utils.time import utcnow

_ENROLLMENT_STATUS_NONE = "none"
_MAX_DISPLAY_NAME_LENGTH = 255
_MAX_SECRET_LENGTH = 4096
# Route selections persist an arbitrary harness_kind bounded only by the
# String(64) column (no allow-list). The policy allow-list must validate
# against that SAME source, otherwise a member can select a harness the admin
# can never allow-list — a permanent, unresolvable violation.
_MAX_HARNESS_KIND_LENGTH = 64

_POLICY_MIN_PLAN_FREE = "free"


@dataclass(frozen=True)
class OrgAgentPolicySnapshot:
    """Effective flag-only policy; ``None`` lists mean "no restriction"."""

    organization_id: UUID
    allowed_routes: tuple[str, ...] | None
    allowed_harnesses: tuple[str, ...] | None
    editable: bool
    updated_by_user_id: UUID | None
    updated_at: datetime | None


async def list_api_keys(db: AsyncSession, *, user_id: UUID) -> list[AgentApiKeyRecord]:
    return await agent_gateway_store.list_agent_api_keys(db, user_id=user_id)


async def create_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    provider: str,
    display_name: str,
    secret: str,
) -> AgentApiKeyRecord:
    if provider not in AGENT_API_KEY_PROVIDERS:
        raise CloudApiError(
            "invalid_agent_api_key_provider",
            f"Provider must be one of: {', '.join(AGENT_API_KEY_PROVIDERS)}.",
            status_code=400,
        )
    display_name = display_name.strip()
    if not display_name or len(display_name) > _MAX_DISPLAY_NAME_LENGTH:
        raise CloudApiError(
            "invalid_agent_api_key_display_name",
            f"Display name must be 1-{_MAX_DISPLAY_NAME_LENGTH} characters.",
            status_code=400,
        )
    secret = secret.strip()
    if not secret or len(secret) > _MAX_SECRET_LENGTH:
        raise CloudApiError(
            "invalid_agent_api_key_secret",
            "The key secret must be a non-empty string.",
            status_code=400,
        )
    record = await agent_gateway_store.create_agent_api_key(
        db,
        user_id=user_id,
        provider=provider,
        display_name=display_name,
        payload=secret,
    )
    log_cloud_event(
        "agent_api_key_created",
        user_id=str(user_id),
        api_key_id=str(record.id),
        provider=record.provider,
    )
    return record


async def revoke_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    api_key_id: UUID,
) -> AgentApiKeyRecord:
    record = await agent_gateway_store.revoke_agent_api_key(
        db,
        user_id=user_id,
        api_key_id=api_key_id,
    )
    if record is None:
        raise CloudApiError(
            "agent_api_key_not_found",
            "Agent API key not found.",
            status_code=404,
        )
    log_cloud_event(
        "agent_api_key_revoked",
        user_id=str(user_id),
        api_key_id=str(record.id),
        provider=record.provider,
    )
    # A revoked key may back a cloud api_key selection; the next pass strips it.
    await materialization_service.schedule_materialize_agent_auth(db, user_id=user_id)
    return record


async def list_route_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> list[AgentAuthRouteSelectionRecord]:
    return await agent_gateway_store.list_route_selections(db, user_id=user_id)


async def upsert_route_selection(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    route: str,
    api_key_id: UUID | None,
    slot: str = AGENT_AUTH_SLOT_PRIMARY,
) -> AgentAuthRouteSelectionRecord:
    try:
        agent_gateway_store.validate_route_selection(
            harness_kind=harness_kind,
            surface=surface,
            route=route,
            api_key_id=api_key_id,
            slot=slot,
        )
    except ValueError as error:
        raise CloudApiError(
            "invalid_agent_route_selection",
            str(error),
            status_code=400,
        ) from error
    try:
        record = await agent_gateway_store.upsert_route_selection(
            db,
            user_id=user_id,
            harness_kind=harness_kind,
            surface=surface,
            route=route,
            api_key_id=api_key_id,
            slot=slot,
        )
    except agent_gateway_store.AgentApiKeyNotUsableError as error:
        raise CloudApiError(
            "agent_api_key_not_found",
            "api_key_id must reference an active key owned by the caller.",
            status_code=404,
        ) from error
    except ValueError as error:
        # Pure legality already passed; the remaining failure mode is an
        # opencode provider slot fed a key of another provider.
        raise CloudApiError(
            "invalid_agent_route_selection",
            str(error),
            status_code=400,
        ) from error
    log_cloud_event(
        "agent_route_selection_upserted",
        user_id=str(user_id),
        harness_kind=harness_kind,
        surface=surface,
        slot=slot,
        route=route,
        api_key_id=str(api_key_id) if api_key_id is not None else None,
        revision=record.revision,
    )
    if surface == AGENT_AUTH_SURFACE_CLOUD:
        await materialization_service.schedule_materialize_agent_auth(db, user_id=user_id)
    return record


async def clear_route_selection(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    slot: str = AGENT_AUTH_SLOT_PRIMARY,
) -> None:
    deleted = await agent_gateway_store.delete_route_selection(
        db,
        user_id=user_id,
        harness_kind=harness_kind,
        surface=surface,
        slot=slot,
    )
    if not deleted:
        raise CloudApiError(
            "agent_route_selection_not_found",
            "No route selection exists for this harness, surface, and slot.",
            status_code=404,
        )
    log_cloud_event(
        "agent_route_selection_cleared",
        user_id=str(user_id),
        harness_kind=harness_kind,
        surface=surface,
        slot=slot,
    )
    if surface == AGENT_AUTH_SURFACE_CLOUD:
        await materialization_service.schedule_materialize_agent_auth(db, user_id=user_id)


async def get_capabilities(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> tuple[bool, str | None, str]:
    """Return (gateway_enabled, public_base_url, enrollment_status)."""
    enrollment = await agent_gateway_store.get_enrollment_for_user(db, user_id=user_id)
    return (
        settings.agent_gateway_enabled,
        settings.agent_gateway_litellm_public_base_url or None,
        enrollment.sync_status if enrollment is not None else _ENROLLMENT_STATUS_NONE,
    )


async def get_auth_state(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
) -> dict[str, object] | None:
    """Render the user's state.json document for one surface.

    Same render path as the cloud materializer; ``None`` means the user has no
    selections for the surface at all (legacy/native fall-through).
    """
    state, _ = await build_agent_auth_state(db, user_id, surface=surface)
    return state


async def get_enrollment(
    db: AsyncSession,
    *,
    user_id: UUID,
) -> AgentGatewayEnrollmentRecord:
    enrollment = await agent_gateway_store.get_enrollment_for_user(db, user_id=user_id)
    if enrollment is None:
        raise CloudApiError(
            "agent_gateway_enrollment_not_found",
            "No agent gateway enrollment exists for this user.",
            status_code=404,
        )
    return enrollment


def _decode_policy_list(raw: str | None) -> tuple[str, ...] | None:
    if raw is None:
        return None
    values = json.loads(raw)
    return tuple(str(value) for value in values)


def _validate_policy_values(
    values: list[str] | None,
    *,
    allowed: tuple[str, ...],
    field: str,
) -> tuple[str, ...] | None:
    if values is None:
        return None
    deduped = tuple(dict.fromkeys(values))
    unknown = [value for value in deduped if value not in allowed]
    if unknown:
        raise CloudApiError(
            "invalid_org_agent_policy",
            f"Unknown {field}: {', '.join(unknown)}. Allowed: {', '.join(allowed)}.",
            status_code=400,
        )
    return deduped


def _validate_policy_harnesses(values: list[str] | None) -> tuple[str, ...] | None:
    """Validate policy harnesses against the SAME source route selections use.

    Route selections accept any harness_kind bounded only by the String(64)
    column, so the policy allow-list applies the same bound (non-empty, <=64)
    rather than an allow-list of SUPPORTED_CLOUD_AGENTS — every selection a
    member can persist must be allow-listable.
    """
    if values is None:
        return None
    deduped = tuple(dict.fromkeys(values))
    invalid = [value for value in deduped if not value or len(value) > _MAX_HARNESS_KIND_LENGTH]
    if invalid:
        raise CloudApiError(
            "invalid_org_agent_policy",
            f"harnesses must each be 1-{_MAX_HARNESS_KIND_LENGTH} characters.",
            status_code=400,
        )
    return deduped


async def org_policy_editing_allowed(db: AsyncSession, *, organization_id: UUID) -> bool:
    """Plan gate for edits (spec §8: editing gated by org plan).

    Choice documented: gate on ``agent_gateway_policy_min_plan``. "free"
    disables the gate; "pro" (default) requires the org billing subject to
    hold a healthy paid cloud subscription or an active unlimited-cloud
    entitlement — the same primitives the billing snapshot uses to call an
    org paid, without computing a full snapshot.
    """
    if settings.agent_gateway_policy_min_plan == _POLICY_MIN_PLAN_FREE:
        return True
    state = await ensure_organization_billing_subject_state(db, organization_id)
    now = utcnow()
    config = billing_plan_rule_config()
    subscriptions = await list_subscriptions(db, state.billing_subject_id)
    if latest_healthy_cloud_subscription(subscriptions, now, config=config) is not None:
        return True
    entitlements = await list_entitlements(db, state.billing_subject_id)
    return active_unlimited_cloud_entitlement(entitlements, now) is not None


async def get_org_policy(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> OrgAgentPolicySnapshot:
    record = await agent_gateway_store.get_org_agent_policy(
        db,
        organization_id=organization_id,
    )
    editable = await org_policy_editing_allowed(db, organization_id=organization_id)
    if record is None:
        return OrgAgentPolicySnapshot(
            organization_id=organization_id,
            allowed_routes=None,
            allowed_harnesses=None,
            editable=editable,
            updated_by_user_id=None,
            updated_at=None,
        )
    return OrgAgentPolicySnapshot(
        organization_id=organization_id,
        allowed_routes=_decode_policy_list(record.allowed_routes_json),
        allowed_harnesses=_decode_policy_list(record.allowed_harnesses_json),
        editable=editable,
        updated_by_user_id=record.updated_by_user_id,
        updated_at=record.updated_at,
    )


async def update_org_policy(
    db: AsyncSession,
    *,
    organization_id: UUID,
    updated_by_user_id: UUID,
    allowed_routes: list[str] | None,
    allowed_harnesses: list[str] | None,
) -> OrgAgentPolicySnapshot:
    routes = _validate_policy_values(
        allowed_routes,
        allowed=AGENT_AUTH_ROUTES,
        field="routes",
    )
    harnesses = _validate_policy_harnesses(allowed_harnesses)
    if not await org_policy_editing_allowed(db, organization_id=organization_id):
        raise CloudApiError(
            "org_agent_policy_plan_required",
            "Editing the org agent policy requires a paid plan.",
            status_code=403,
        )
    record = await agent_gateway_store.set_org_agent_policy(
        db,
        organization_id=organization_id,
        allowed_routes_json=json.dumps(list(routes)) if routes is not None else None,
        allowed_harnesses_json=(json.dumps(list(harnesses)) if harnesses is not None else None),
        updated_by_user_id=updated_by_user_id,
    )
    log_cloud_event(
        "org_agent_policy_updated",
        organization_id=str(organization_id),
        updated_by_user_id=str(updated_by_user_id),
        allowed_routes=list(routes) if routes is not None else None,
        allowed_harnesses=list(harnesses) if harnesses is not None else None,
    )
    return OrgAgentPolicySnapshot(
        organization_id=organization_id,
        allowed_routes=_decode_policy_list(record.allowed_routes_json),
        allowed_harnesses=_decode_policy_list(record.allowed_harnesses_json),
        editable=True,
        updated_by_user_id=record.updated_by_user_id,
        updated_at=record.updated_at,
    )


def selection_violates_policy(
    selection: OrgMemberRouteSelectionRecord,
    *,
    allowed_routes: tuple[str, ...] | None,
    allowed_harnesses: tuple[str, ...] | None,
) -> bool:
    """Flag-only conflict check; nothing is ever blocked."""
    if allowed_routes is not None and selection.route not in allowed_routes:
        return True
    return allowed_harnesses is not None and selection.harness_kind not in allowed_harnesses


async def list_org_policy_violations(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> list[OrgMemberRouteSelectionRecord]:
    """Members whose active selections conflict with the policy, computed live."""
    policy = await get_org_policy(db, organization_id=organization_id)
    if policy.allowed_routes is None and policy.allowed_harnesses is None:
        return []
    selections = await agent_gateway_store.list_org_member_route_selections(
        db,
        organization_id=organization_id,
    )
    return [
        selection
        for selection in selections
        if selection_violates_policy(
            selection,
            allowed_routes=policy.allowed_routes,
            allowed_harnesses=policy.allowed_harnesses,
        )
    ]
