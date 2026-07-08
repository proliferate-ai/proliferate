"""Agent gateway auth services: key vault, auth selections, capabilities.

The P1 auth model (contract ``codex/p1-auth-contract.md`` §5): a titled,
provider-less key vault plus per-(user, harness, surface) selection sources
written as full desired state. Store legality errors surface as typed
:class:`CloudApiError` values so the API layer maps them uniformly. Key and
selection mutations emit structured audit log events (the cloud event log is
the post-Bifrost audit surface).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.agent_gateway import (
    AGENT_AUTH_POLICY_ROUTES,
    AGENT_AUTH_ROUTE_NATIVE,
    AGENT_AUTH_SURFACE_CLOUD,
)
from proliferate.db.store import agent_gateway as agent_gateway_store
from proliferate.db.store.agent_gateway import (
    AgentApiKeyRecord,
    AgentAuthSelectionRecord,
    AgentGatewayEnrollmentRecord,
    DesiredAuthSource,
    OrgMemberRouteSelectionRecord,
)
from proliferate.db.store.billing import list_entitlements
from proliferate.db.store.billing_subscriptions import list_subscriptions
from proliferate.db.store.organizations import list_organizations_for_user
from proliferate.server.billing.domain.plans import (
    active_unlimited_cloud_entitlement,
    latest_healthy_cloud_subscription,
)
from proliferate.server.billing.snapshots import billing_plan_rule_config
from proliferate.server.billing.subjects import ensure_organization_billing_subject_state
from proliferate.server.cloud.agent_gateway.selection_rules import (
    SelectionRuleError,
    validate_auth_selection_set,
)
from proliferate.server.cloud.errors import CloudApiError
from proliferate.server.cloud.event_logging import log_cloud_event
from proliferate.server.cloud.materialization import service as materialization_service
from proliferate.server.cloud.materialization.materialize.agent_auth import (
    build_agent_auth_state,
)
from proliferate.utils.time import utcnow

_ENROLLMENT_STATUS_NONE = "none"
_MAX_TITLE_LENGTH = 255
_MAX_SECRET_LENGTH = 4096
# Selections persist an arbitrary harness_kind bounded only by the String(64)
# column. The policy allow-list validates against that SAME source, otherwise a
# member could select a harness the admin can never allow-list — a permanent,
# unresolvable violation.
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


# --------------------------------------------------------------------------- #
# Key vault
# --------------------------------------------------------------------------- #


async def list_api_keys(db: AsyncSession, *, user_id: UUID) -> list[AgentApiKeyRecord]:
    return await agent_gateway_store.list_agent_api_keys(db, user_id=user_id)


async def key_titles(db: AsyncSession, *, user_id: UUID) -> dict[UUID, str]:
    """``api_key_id`` → title for every key (incl. revoked), for selection joins."""
    records = await agent_gateway_store.list_agent_api_keys(
        db, user_id=user_id, include_revoked=True
    )
    return {record.id: record.title for record in records}


async def create_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    title: str,
    value: str,
) -> AgentApiKeyRecord:
    title = title.strip()
    if not title or len(title) > _MAX_TITLE_LENGTH:
        raise CloudApiError(
            "invalid_agent_api_key_title",
            f"Title must be 1-{_MAX_TITLE_LENGTH} characters.",
            status_code=400,
        )
    value = value.strip()
    if not value or len(value) > _MAX_SECRET_LENGTH:
        raise CloudApiError(
            "invalid_agent_api_key_value",
            "The key value must be a non-empty string.",
            status_code=400,
        )
    record = await agent_gateway_store.create_agent_api_key(
        db,
        user_id=user_id,
        title=title,
        value=value,
    )
    log_cloud_event(
        "agent_api_key_created",
        user_id=str(user_id),
        api_key_id=str(record.id),
    )
    return record


async def revoke_api_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    api_key_id: UUID,
) -> AgentApiKeyRecord:
    # A key wired into any ENABLED selection cannot be revoked out from under a
    # live launch: reject with the referencing harnesses so the caller disables
    # those rows first (contract §5).
    referencing = await agent_gateway_store.list_enabled_selections_referencing_key(
        db, user_id=user_id, api_key_id=api_key_id
    )
    if referencing:
        harnesses = sorted({record.harness_kind for record in referencing})
        raise CloudApiError(
            "agent_api_key_referenced",
            "This key is used by an enabled selection; disable those first.",
            status_code=409,
            extra_detail={"harnesses": harnesses},
        )
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
    )
    return record


# --------------------------------------------------------------------------- #
# Auth selections
# --------------------------------------------------------------------------- #


async def list_auth_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str | None = None,
) -> list[AgentAuthSelectionRecord]:
    return await agent_gateway_store.list_auth_selections(db, user_id=user_id, surface=surface)


async def put_auth_selections(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    sources: Sequence[DesiredAuthSource],
) -> list[AgentAuthSelectionRecord]:
    """Replace a scope's selection sources with the full desired list.

    Runs the per-harness legality validator (contract §2), then the store diff
    (structural coherence + key ownership), bumps the surface revision implicitly
    via row updated_at, and schedules cloud materialization.
    """
    try:
        validate_auth_selection_set(harness_kind=harness_kind, sources=sources)
    except SelectionRuleError as error:
        raise CloudApiError(
            "invalid_agent_auth_selection",
            str(error),
            status_code=400,
        ) from error

    # Org policy is a HARD gate at select-time: a member may not persist a
    # selection set that violates any org they belong to (personal/non-org
    # users have no memberships, so this is a no-op for them). Existing rows at
    # rest are never touched — the violations report keeps covering stale ones.
    await _enforce_org_selection_policy(
        db,
        user_id=user_id,
        harness_kind=harness_kind,
        sources=sources,
    )

    try:
        rows = await agent_gateway_store.put_auth_selections(
            db,
            user_id=user_id,
            harness_kind=harness_kind,
            surface=surface,
            sources=sources,
        )
    except agent_gateway_store.AgentApiKeyNotUsableError as error:
        raise CloudApiError(
            "agent_api_key_not_found",
            "apiKeyId must reference an active key owned by the caller.",
            status_code=404,
        ) from error
    except ValueError as error:
        # Unknown harness/surface or a malformed/duplicate source shape.
        raise CloudApiError(
            "invalid_agent_auth_selection",
            str(error),
            status_code=400,
        ) from error

    log_cloud_event(
        "agent_auth_selections_put",
        user_id=str(user_id),
        harness_kind=harness_kind,
        surface=surface,
        source_count=len(rows),
        enabled_count=sum(1 for row in rows if row.enabled),
    )
    if surface == AGENT_AUTH_SURFACE_CLOUD:
        await materialization_service.schedule_materialize_agent_auth(db, user_id=user_id)
    return rows


async def put_harness_settings(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    surface: str,
    settings_dict: dict[str, object],
) -> dict[str, object]:
    """Validate shape (all values must be bool) and upsert harness settings."""
    for key, value in settings_dict.items():
        if not isinstance(key, str) or not isinstance(value, bool):
            raise CloudApiError(
                "invalid_harness_settings",
                "Settings must be a dict[str, bool]. "
                f"Key {key!r} has value of type {type(value).__name__}.",
                status_code=400,
            )
    return await agent_gateway_store.put_harness_settings(
        db,
        user_id=user_id,
        harness_kind=harness_kind,
        surface=surface,
        settings=settings_dict,
    )


async def get_auth_state(
    db: AsyncSession,
    *,
    user_id: UUID,
    surface: str,
) -> dict[str, object]:
    """Render the user's state.json v2 document for one surface.

    Same render path as the cloud materializer. A surface with no resolvable
    enabled sources renders as a v2 doc with an empty ``harnesses`` list.
    """
    state, _ = await build_agent_auth_state(db, user_id, surface=surface)
    return state


# --------------------------------------------------------------------------- #
# Capabilities + enrollment
# --------------------------------------------------------------------------- #


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


# --------------------------------------------------------------------------- #
# Org policy (flag-only)
# --------------------------------------------------------------------------- #


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
    """Validate policy harnesses against the SAME source selections use.

    Selections accept any harness_kind bounded only by the String(64) column, so
    the policy allow-list applies the same bound (non-empty, <=64) rather than an
    allow-list of supported kinds — every selection a member can persist must be
    allow-listable.
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

    Gate on ``agent_gateway_policy_min_plan``. "free" disables the gate; "pro"
    (default) requires the org billing subject to hold a healthy paid cloud
    subscription or an active unlimited-cloud entitlement.
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
    # "routes" are the selection source kinds (gateway/api_key) PLUS "native",
    # the empty-selection state. Native carries no selection row, but it is a
    # valid policy allow-list value: listing it permits native CLI login,
    # omitting it (when the list is otherwise set) disallows it.
    routes = _validate_policy_values(
        allowed_routes,
        allowed=AGENT_AUTH_POLICY_ROUTES,
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
    """Flag-only conflict check for selections AT REST; nothing here is blocked.

    This powers the violations report (existing enabled rows). Select-time
    blocking of NEW writes lives in :func:`_enforce_org_selection_policy`.
    """
    if allowed_routes is not None and selection.source_kind not in allowed_routes:
        return True
    return allowed_harnesses is not None and selection.harness_kind not in allowed_harnesses


def _selection_set_policy_violation(
    *,
    harness_kind: str,
    sources: Sequence[DesiredAuthSource],
    allowed_routes: tuple[str, ...] | None,
    allowed_harnesses: tuple[str, ...] | None,
) -> str | None:
    """Return a member-facing message if this desired set violates the policy.

    Mirrors the at-rest report semantics: only ENABLED sources count (disabled
    rows never launch), and an empty enabled set == native CLI login. The
    harness check only applies when the desired set has an enabled source —
    an empty/all-disabled set must always be allowed so a member can clear a
    pre-existing selection on a harness the org has since disallowed (there is
    no other way to comply, since there is no DELETE endpoint).
    """
    enabled = [source for source in sources if source.enabled]
    if (
        allowed_harnesses is not None
        and harness_kind not in allowed_harnesses
        and enabled
    ):
        return (
            f"Harness '{harness_kind}' is not allowed by your organization's policy."
        )
    if allowed_routes is None:
        return None
    if not enabled:
        # Zero enabled sources == the harness's own (native) CLI login.
        if AGENT_AUTH_ROUTE_NATIVE not in allowed_routes:
            return (
                "Native CLI login is not allowed by your organization's policy."
            )
        return None
    for source in enabled:
        if source.source_kind not in allowed_routes:
            return (
                f"Auth route '{source.source_kind}' is not allowed by "
                "your organization's policy."
            )
    return None


async def _enforce_org_selection_policy(
    db: AsyncSession,
    *,
    user_id: UUID,
    harness_kind: str,
    sources: Sequence[DesiredAuthSource],
) -> None:
    """Reject a desired selection set that violates any of the user's orgs.

    A member may belong to several orgs; a route/harness disallowed by ANY of
    them is disallowed for the member (the strictest wins). Personal users have
    no memberships, so this returns immediately. The stored policy row is read
    directly (raw allow-lists), independent of the plan-based edit gate: a
    policy that exists is enforced even if the org's edit entitlement lapsed.
    """
    memberships = await list_organizations_for_user(db, user_id)
    for record in memberships:
        policy_row = await agent_gateway_store.get_org_agent_policy(
            db,
            organization_id=record.organization.id,
        )
        if policy_row is None:
            continue
        message = _selection_set_policy_violation(
            harness_kind=harness_kind,
            sources=sources,
            allowed_routes=_decode_policy_list(policy_row.allowed_routes_json),
            allowed_harnesses=_decode_policy_list(policy_row.allowed_harnesses_json),
        )
        if message is not None:
            raise CloudApiError(
                "policy_violation",
                message,
                status_code=403,
            )


async def list_org_policy_violations(
    db: AsyncSession,
    *,
    organization_id: UUID,
) -> list[OrgMemberRouteSelectionRecord]:
    """Members whose enabled selections conflict with the policy, computed live."""
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
