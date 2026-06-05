"""Billing service layer."""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import (
    AuthenticatedUser,
    OwnerContext,
    OwnerSelection,
    require_org_role,
)
from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_SUBJECT_KIND_PERSONAL,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    FREE_INCLUDED_GRANT_TYPE,
    FREE_TRIAL_V2_GRANT_TYPE,
    PRO_OVERAGE_CAP_CENTS_PER_SEAT_MAX,
)
from proliferate.constants.organizations import (
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_OWNER,
)
from proliferate.db import session_ops as db_session
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingSubscription,
)
from proliferate.db.store import billing_seats, billing_subscriptions
from proliferate.db.store.billing_accounting import (
    BillingAccountingResult,
    ClaimedUsageExport,
    list_billing_subject_ids_for_usage_accounting,
)
from proliferate.db.store.billing_runtime_usage import (
    close_usage_segment_for_sandbox,
    open_usage_segment_for_sandbox,
    record_billing_decision_event,
    remember_sandbox_event_receipt,
)
from proliferate.db.store.billing_subjects import (
    BillingSubjectStripeState,
    bind_stripe_customer_to_billing_subject,
    get_or_create_organization_stripe_customer_state,
    get_or_create_user_stripe_customer_state,
    set_overage_policy_for_subject,
    set_overage_policy_for_user,
)
from proliferate.db.store.organizations import (
    get_organization_with_membership,
    load_organization_by_billing_subject,
)
from proliferate.errors import ProliferateError
from proliferate.integrations import stripe as stripe_billing
from proliferate.server.billing import accounting as billing_accounting_service
from proliferate.server.billing import authorization as billing_authorization
from proliferate.server.billing import snapshot_state
from proliferate.server.billing import snapshots as billing_snapshots
from proliferate.server.billing.domain.accounting import (
    stripe_status_is_terminal,
)
from proliferate.server.billing.domain.plans import UnlimitedCloudHoursState
from proliferate.server.billing.models import (
    BillingOverview,
    BillingReturnSurface,
    BillingServiceError,
    BillingSnapshot,
    BillingUrlResponse,
    CloudPlanInfo,
    GrantAllocation,
    GrantAllocationInfo,
    OverageSettingsResponse,
    PlanInfo,
    SandboxStartAuthorization,
    utcnow,
)
from proliferate.server.billing.pricing import (
    configured_managed_cloud_overage_price_id,
    configured_pro_monthly_price_id,
    validate_cloud_subscription_price_configuration,
    validate_pro_subscription_price_configuration,
    validate_refill_price_configuration,
)
from proliferate.server.billing.snapshot_state import BillingSnapshotState

logger = logging.getLogger("proliferate.billing.service")


def _compute_unlimited_cloud_hours_state(
    *,
    subscriptions: list[BillingSubscription],
    entitlements: list[BillingEntitlement],
    now: datetime,
) -> UnlimitedCloudHoursState:
    return billing_snapshots.compute_unlimited_cloud_hours_state_for_settings(
        subscriptions=subscriptions,
        entitlements=entitlements,
        now=now,
    )


def _subscription_is_pro(subscription: BillingSubscription) -> bool:
    return billing_snapshots.subscription_is_pro_for_settings(subscription)


def repo_limit_for_billing_snapshot(snapshot: BillingSnapshot) -> int | None:
    return billing_snapshots.repo_limit_for_billing_snapshot(snapshot)


async def ensure_personal_billing_subject_state(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSubjectStripeState:
    return await get_or_create_user_stripe_customer_state(db, user_id)


async def ensure_organization_billing_subject_state(
    db: AsyncSession,
    organization_id: UUID,
) -> BillingSubjectStripeState:
    return await get_or_create_organization_stripe_customer_state(db, organization_id)


async def maybe_create_organization_seat_adjustment(
    db: AsyncSession,
    *,
    organization_id: UUID,
    membership_id: UUID | None,
) -> bool:
    return await billing_seats.maybe_create_org_seat_adjustment(
        db,
        organization_id=organization_id,
        membership_id=membership_id,
        pro_billing_enabled=settings.pro_billing_enabled,
        pro_monthly_price_id=configured_pro_monthly_price_id(),
    )


async def reconcile_initial_org_subscription_seats(
    record: BillingSubscription,
) -> BillingSubscription:
    async with db_session.open_async_transaction() as db:
        adjustment = await billing_seats.prepare_initial_org_seat_reconcile(
            db,
            billing_subscription_id=record.id,
            pro_billing_enabled=settings.pro_billing_enabled,
            pro_monthly_price_id=configured_pro_monthly_price_id(),
        )
    if adjustment is None:
        async with db_session.open_async_session() as db:
            reloaded = await billing_subscriptions.load_billing_subscription_by_id(db, record.id)
        return reloaded or record
    try:
        await stripe_billing.update_subscription_item_quantity(
            subscription_item_id=adjustment.monthly_subscription_item_id,
            quantity=adjustment.target_quantity,
            idempotency_key=f"initial-seat-reconcile:{adjustment.id}:seats:{adjustment.target_quantity}",
        )
        async with db_session.open_async_transaction() as db:
            await billing_seats.mark_seat_adjustment_stripe_confirmed(
                db,
                adjustment_id=adjustment.id,
            )
        async with db_session.open_async_transaction() as db:
            await billing_seats.mark_seat_adjustment_grant_issued(
                db,
                adjustment_id=adjustment.id,
            )
    except stripe_billing.StripeBillingError as error:
        async with db_session.open_async_transaction() as db:
            await billing_seats.mark_seat_adjustment_failed(
                db,
                adjustment_id=adjustment.id,
                error=error.message,
                terminal=stripe_status_is_terminal(error.status_code),
            )
        raise
    except Exception as error:
        async with db_session.open_async_transaction() as db:
            await billing_seats.mark_seat_adjustment_failed(
                db,
                adjustment_id=adjustment.id,
                error=f"{type(error).__name__}: {error}",
            )
        raise
    async with db_session.open_async_session() as db:
        reloaded = await billing_subscriptions.load_billing_subscription_by_id(db, record.id)
    return reloaded or record


async def remember_cloud_sandbox_event_receipt(
    db: AsyncSession,
    *,
    event_id: str,
    provider: str,
    event_type: str,
    external_sandbox_id: str | None,
) -> bool:
    return await remember_sandbox_event_receipt(
        db,
        event_id=event_id,
        provider=provider,
        event_type=event_type,
        external_sandbox_id=external_sandbox_id,
    )


async def record_cloud_sandbox_usage_started(
    *,
    runtime_environment_id: UUID | None = None,
    workspace_id: UUID | None = None,
    sandbox_id: UUID,
    external_sandbox_id: str | None,
    sandbox_execution_id: str | None,
    started_at: datetime,
    opened_by: str,
    user_id: UUID | None = None,
    is_billable: bool = True,
    event_id: str | None = None,
) -> object:
    async with db_session.open_async_transaction() as db:
        return await open_usage_segment_for_sandbox(
            db,
            runtime_environment_id=runtime_environment_id,
            workspace_id=workspace_id,
            sandbox_id=sandbox_id,
            external_sandbox_id=external_sandbox_id,
            sandbox_execution_id=sandbox_execution_id,
            started_at=started_at,
            opened_by=opened_by,
            user_id=user_id,
            is_billable=is_billable,
            event_id=event_id,
        )


async def record_cloud_sandbox_usage_stopped(
    *,
    sandbox_id: UUID,
    ended_at: datetime,
    closed_by: str,
    is_billable: bool | None = None,
    event_id: str | None = None,
) -> object | None:
    async with db_session.open_async_transaction() as db:
        return await close_usage_segment_for_sandbox(
            db,
            sandbox_id=sandbox_id,
            ended_at=ended_at,
            closed_by=closed_by,
            is_billable=is_billable,
            event_id=event_id,
        )


async def get_billing_snapshot(user_id: UUID) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot(user_id)


async def get_billing_snapshot_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_request(db, user_id)


async def get_billing_snapshot_for_subject(billing_subject_id: UUID) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_subject(billing_subject_id)


async def get_billing_snapshot_for_subject_in_session(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_subject_in_session(
        db,
        billing_subject_id,
    )


async def _get_billing_snapshot_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_request(db, user_id)


async def _get_billing_snapshot_for_subject_request(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshot:
    return await billing_snapshots.get_billing_snapshot_for_subject_in_session(
        db,
        billing_subject_id,
    )


def _build_billing_snapshot(state: BillingSnapshotState) -> BillingSnapshot:
    return billing_snapshots.build_billing_snapshot(state)


async def authorize_sandbox_start_for_billing_subject(
    *,
    actor_user_id: UUID | None,
    billing_subject_id: UUID,
    workspace_id: UUID | None = None,
) -> SandboxStartAuthorization:
    return await billing_authorization.authorize_sandbox_start_for_billing_subject(
        actor_user_id=actor_user_id,
        billing_subject_id=billing_subject_id,
        workspace_id=workspace_id,
    )


async def authorize_sandbox_start(
    *,
    user_id: UUID,
    workspace_id: UUID | None,
) -> SandboxStartAuthorization:
    return await billing_authorization.authorize_sandbox_start(
        user_id=user_id,
        workspace_id=workspace_id,
    )


async def get_billing_overview(db: AsyncSession, user_id: UUID) -> BillingOverview:
    snapshot = await _get_billing_snapshot_for_request(db, user_id)
    return _billing_overview_from_snapshot(snapshot)


async def get_billing_overview_for_owner(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection,
) -> BillingOverview:
    context = await _resolve_billing_owner_context(db, user, owner_selection)
    snapshot = await _get_billing_snapshot_for_subject_request(db, context.billing_subject_id)
    return _billing_overview_from_snapshot(snapshot)


async def get_current_plan(db: AsyncSession, user_id: UUID) -> PlanInfo:
    snapshot = await _get_billing_snapshot_for_request(db, user_id)
    return PlanInfo(
        plan=snapshot.plan,
        usage_minutes=int(round(snapshot.used_hours * 60.0)),
        pro_billing_enabled=snapshot.pro_billing_enabled,
    )


async def get_cloud_plan(db: AsyncSession, user_id: UUID) -> CloudPlanInfo:
    snapshot = await _get_billing_snapshot_for_request(db, user_id)
    return _cloud_plan_from_snapshot(snapshot)


async def get_cloud_plan_for_owner(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection,
) -> CloudPlanInfo:
    context = await _resolve_billing_owner_context(db, user, owner_selection)
    snapshot = await _get_billing_snapshot_for_subject_request(db, context.billing_subject_id)
    return _cloud_plan_from_snapshot(snapshot)


def _billing_overview_from_snapshot(snapshot: BillingSnapshot) -> BillingOverview:
    return BillingOverview(
        plan=snapshot.plan,
        billing_mode=snapshot.billing_mode,
        pro_billing_enabled=snapshot.pro_billing_enabled,
        is_unlimited=snapshot.is_unlimited,
        has_unlimited_cloud_hours=snapshot.has_unlimited_cloud_hours,
        over_quota=snapshot.over_quota,
        included_hours=(
            round(snapshot.included_hours, 2) if snapshot.included_hours is not None else None
        ),
        used_hours=round(snapshot.used_hours, 4),
        remaining_hours=(
            round(snapshot.remaining_hours, 4) if snapshot.remaining_hours is not None else None
        ),
        cloud_repo_limit=snapshot.cloud_repo_limit,
        active_cloud_repo_count=snapshot.active_cloud_repo_count,
        concurrent_sandbox_limit=snapshot.concurrent_sandbox_limit,
        active_sandbox_count=snapshot.active_sandbox_count,
        is_paid_cloud=snapshot.is_paid_cloud,
        payment_healthy=snapshot.payment_healthy,
        overage_enabled=snapshot.overage_enabled,
        hosted_invoice_url=snapshot.hosted_invoice_url,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
        billable_seat_count=snapshot.billable_seat_count,
        included_managed_cloud_hours=(
            round(snapshot.included_managed_cloud_hours, 2)
            if snapshot.included_managed_cloud_hours is not None
            else None
        ),
        remaining_managed_cloud_hours=(
            round(snapshot.remaining_managed_cloud_hours, 4)
            if snapshot.remaining_managed_cloud_hours is not None
            else None
        ),
        managed_cloud_overage_enabled=snapshot.managed_cloud_overage_enabled,
        managed_cloud_overage_cap_cents=snapshot.managed_cloud_overage_cap_cents,
        managed_cloud_overage_used_cents=snapshot.managed_cloud_overage_used_cents,
        overage_price_per_hour_cents=snapshot.overage_price_per_hour_cents,
        active_environment_limit=snapshot.active_environment_limit,
        repo_environment_limit=snapshot.repo_environment_limit,
        byo_runtime_allowed=snapshot.byo_runtime_allowed,
        legacy_cloud_subscription=snapshot.legacy_cloud_subscription,
    )


def _cloud_plan_from_snapshot(snapshot: BillingSnapshot) -> CloudPlanInfo:
    return CloudPlanInfo(
        plan=snapshot.plan,
        billing_mode=snapshot.billing_mode,
        pro_billing_enabled=snapshot.pro_billing_enabled,
        is_unlimited=snapshot.is_unlimited,
        has_unlimited_cloud_hours=snapshot.has_unlimited_cloud_hours,
        over_quota=snapshot.over_quota,
        free_sandbox_hours=(
            round(snapshot.included_hours, 2) if snapshot.included_hours is not None else None
        ),
        used_sandbox_hours=round(snapshot.used_hours, 4),
        remaining_sandbox_hours=(
            round(snapshot.remaining_hours, 4) if snapshot.remaining_hours is not None else None
        ),
        cloud_repo_limit=snapshot.cloud_repo_limit,
        active_cloud_repo_count=snapshot.active_cloud_repo_count,
        concurrent_sandbox_limit=snapshot.concurrent_sandbox_limit,
        active_sandbox_count=snapshot.active_sandbox_count,
        is_paid_cloud=snapshot.is_paid_cloud,
        payment_healthy=snapshot.payment_healthy,
        overage_enabled=snapshot.overage_enabled,
        hosted_invoice_url=snapshot.hosted_invoice_url,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
        billable_seat_count=snapshot.billable_seat_count,
        included_managed_cloud_hours=(
            round(snapshot.included_managed_cloud_hours, 2)
            if snapshot.included_managed_cloud_hours is not None
            else None
        ),
        remaining_managed_cloud_hours=(
            round(snapshot.remaining_managed_cloud_hours, 4)
            if snapshot.remaining_managed_cloud_hours is not None
            else None
        ),
        managed_cloud_overage_enabled=snapshot.managed_cloud_overage_enabled,
        managed_cloud_overage_cap_cents=snapshot.managed_cloud_overage_cap_cents,
        managed_cloud_overage_used_cents=snapshot.managed_cloud_overage_used_cents,
        overage_price_per_hour_cents=snapshot.overage_price_per_hour_cents,
        active_environment_limit=snapshot.active_environment_limit,
        repo_environment_limit=snapshot.repo_environment_limit,
        byo_runtime_allowed=snapshot.byo_runtime_allowed,
        legacy_cloud_subscription=snapshot.legacy_cloud_subscription,
        grant_allocations=[
            _grant_allocation_info(allocation) for allocation in snapshot.grant_allocations
        ],
    )


def _grant_allocation_info(allocation: GrantAllocation) -> GrantAllocationInfo:
    return GrantAllocationInfo(
        grant_type=allocation.grant_type,
        total_seconds=round(allocation.total_seconds, 4),
        consumed_seconds=round(allocation.consumed_seconds, 4),
        remaining_seconds=round(allocation.remaining_seconds, 4),
        active=allocation.active,
    )


def is_free_included_grant(grant_type: str) -> bool:
    if settings.pro_billing_enabled:
        return grant_type == FREE_TRIAL_V2_GRANT_TYPE
    return grant_type == FREE_INCLUDED_GRANT_TYPE


def _map_stripe_error(error: stripe_billing.StripeBillingError) -> BillingServiceError:
    return BillingServiceError(error.code, error.message, status_code=error.status_code)


def _with_billing_return_surface(url: str, return_surface: BillingReturnSurface) -> str:
    if return_surface == "web":
        return url
    parts = urlsplit(url)
    params = parse_qsl(parts.query, keep_blank_values=True)
    params = [(key, value) for key, value in params if key != "returnSurface"]
    params.append(("returnSurface", return_surface))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(params), parts.fragment))


def _require_redirect_urls(
    return_surface: BillingReturnSurface = "web",
) -> tuple[str, str, str]:
    success_url = settings.stripe_checkout_success_url
    cancel_url = settings.stripe_checkout_cancel_url
    portal_return_url = settings.stripe_customer_portal_return_url
    if not (success_url and cancel_url and portal_return_url):
        raise BillingServiceError(
            "stripe_redirect_urls_unconfigured",
            "Stripe redirect URLs are not configured.",
            status_code=503,
        )
    return (
        _with_billing_return_surface(success_url, return_surface),
        _with_billing_return_surface(cancel_url, return_surface),
        _with_billing_return_surface(portal_return_url, return_surface),
    )


def _idempotency_shape_suffix(*parts: str | int | None) -> str:
    payload = "\0".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _require_owner_selection_uuid(value: str | UUID | None, *, field: str) -> UUID:
    if isinstance(value, UUID):
        return value
    if value:
        try:
            return UUID(value)
        except ValueError as exc:
            raise BillingServiceError(
                "invalid_organization_id",
                f"{field} must be a valid UUID.",
                status_code=400,
            ) from exc
    raise BillingServiceError(
        "missing_organization_id",
        f"{field} is required for organization scope.",
        status_code=400,
    )


async def _resolve_billing_owner_context(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection,
) -> OwnerContext:
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "personal":
        if selection.organization_id is not None:
            raise BillingServiceError(
                "invalid_owner_selection",
                "organizationId is not valid for personal scope.",
                status_code=400,
            )
        state = await get_or_create_user_stripe_customer_state(db, user.id)
        if state.kind != BILLING_SUBJECT_KIND_PERSONAL:
            raise BillingServiceError(
                "invalid_owner_selection",
                "Personal billing subject could not be resolved.",
                status_code=500,
            )
        return OwnerContext(
            owner_scope="personal",
            actor_user_id=user.id,
            owner_user_id=user.id,
            organization_id=None,
            membership_id=None,
            membership_role=None,
            billing_subject_id=state.billing_subject_id,
        )

    organization_id = _require_owner_selection_uuid(
        selection.organization_id,
        field="organizationId",
    )
    record = await get_organization_with_membership(
        db,
        organization_id=organization_id,
        user_id=user.id,
    )
    if record is None:
        raise BillingServiceError(
            "organization_not_found",
            "Organization not found.",
            status_code=404,
        )
    state = await get_or_create_organization_stripe_customer_state(db, organization_id)
    return OwnerContext(
        owner_scope="organization",
        actor_user_id=user.id,
        owner_user_id=None,
        organization_id=organization_id,
        membership_id=record.membership.id,
        membership_role=record.membership.role,
        billing_subject_id=state.billing_subject_id,
    )


async def _ensure_stripe_customer_for_owner(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection,
    *,
    owner_context: OwnerContext | None = None,
) -> tuple[UUID, str]:
    async with db.begin():
        context = owner_context or await _resolve_billing_owner_context(db, user, owner_selection)
        if context.owner_scope == "organization":
            try:
                require_org_role(context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
            except ProliferateError as error:
                raise BillingServiceError(
                    error.code,
                    error.message,
                    status_code=error.status_code,
                ) from error
            if context.organization_id is None:
                raise BillingServiceError(
                    "organization_not_found",
                    "Organization not found.",
                    status_code=404,
                )
            state = await get_or_create_organization_stripe_customer_state(
                db,
                context.organization_id,
            )
            organization = await load_organization_by_billing_subject(
                db,
                state.billing_subject_id,
            )
            customer_name = organization.name if organization is not None else "Organization"
            organization_id = str(context.organization_id)
            created_by_user_id = str(user.id)
        else:
            state = await get_or_create_user_stripe_customer_state(db, user.id)
            customer_name = None
            organization_id = None
            created_by_user_id = None
    if state.stripe_customer_id:
        return state.billing_subject_id, state.stripe_customer_id
    try:
        customer = await stripe_billing.create_customer(
            email=user.email,
            name=customer_name,
            billing_subject_id=str(state.billing_subject_id),
            organization_id=organization_id,
            created_by_user_id=created_by_user_id,
            idempotency_key=f"customer:{state.billing_subject_id}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    customer_id = customer.get("id")
    if not isinstance(customer_id, str):
        raise BillingServiceError(
            "stripe_invalid_response",
            "Stripe did not return a customer id.",
            status_code=502,
        )
    async with db.begin():
        state = await bind_stripe_customer_to_billing_subject(
            db,
            billing_subject_id=state.billing_subject_id,
            stripe_customer_id=customer_id,
        )
    return state.billing_subject_id, customer_id


async def create_cloud_checkout_session(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection | None = None,
    return_surface: BillingReturnSurface = "web",
) -> BillingUrlResponse:
    selection = owner_selection or OwnerSelection()
    org_context: OwnerContext | None = None
    if selection.owner_scope == "organization":
        async with db.begin():
            org_context = await _resolve_billing_owner_context(db, user, selection)
            try:
                require_org_role(org_context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
            except ProliferateError as error:
                raise BillingServiceError(
                    error.code,
                    error.message,
                    status_code=error.status_code,
                ) from error
        if not settings.pro_billing_enabled:
            raise BillingServiceError(
                "org_pro_billing_disabled",
                "Organization Pro billing is not available yet.",
                status_code=409,
            )
    success_url, cancel_url, portal_return_url = _require_redirect_urls(return_surface)
    if settings.pro_billing_enabled:
        await validate_pro_subscription_price_configuration()
    else:
        await validate_cloud_subscription_price_configuration()

    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
        user,
        selection,
        owner_context=org_context,
    )
    async with db.begin():
        snapshot = await _get_billing_snapshot_for_subject_request(db, subject_id)
        seat_quantity = (
            await billing_seats.count_active_seats_for_billing_subject_id(db, subject_id)
            if org_context is not None and not snapshot.is_paid_cloud
            else 1
        )
    if snapshot.is_paid_cloud:
        try:
            portal = await stripe_billing.create_customer_portal_session(
                stripe_customer_id=stripe_customer_id,
                return_url=portal_return_url,
                idempotency_key=(
                    f"portal:active-cloud:{subject_id}:"
                    f"{_idempotency_shape_suffix(portal_return_url)}"
                ),
            )
        except stripe_billing.StripeBillingError as error:
            raise _map_stripe_error(error) from error
        return BillingUrlResponse(url=portal.url)

    try:
        monthly_price_id = (
            configured_pro_monthly_price_id()
            if settings.pro_billing_enabled
            else settings.stripe_cloud_monthly_price_id
        )
        overage_price_id = (
            configured_managed_cloud_overage_price_id() if settings.pro_billing_enabled else None
        )
        checkout_shape = _idempotency_shape_suffix(
            monthly_price_id,
            overage_price_id,
            seat_quantity,
            success_url,
            cancel_url,
        )
        checkout = await stripe_billing.create_subscription_checkout_session(
            stripe_customer_id=stripe_customer_id,
            billing_subject_id=str(subject_id),
            organization_id=(
                str(org_context.organization_id)
                if org_context is not None and org_context.organization_id is not None
                else None
            ),
            created_by_user_id=str(user.id) if org_context is not None else None,
            cloud_monthly_price_id=monthly_price_id,
            overage_price_id=overage_price_id,
            seat_quantity=seat_quantity,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=(
                f"cloud-checkout:org:{subject_id}:seats:{seat_quantity}:{checkout_shape}"
                if org_context is not None
                else f"cloud-checkout:{subject_id}:{checkout_shape}"
            ),
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingUrlResponse(url=checkout.url)


async def create_refill_checkout_session(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection | None = None,
    return_surface: BillingReturnSurface = "web",
) -> BillingUrlResponse:
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "organization":
        raise BillingServiceError(
            "refill_checkout_not_supported_for_org",
            "Refill checkout is not supported for organizations.",
            status_code=409,
        )
    if settings.pro_billing_enabled:
        raise BillingServiceError(
            "refill_checkout_disabled",
            "Refill checkout is not available for Pro billing.",
            status_code=409,
        )
    success_url, cancel_url, _portal_return_url = _require_redirect_urls(return_surface)
    await validate_refill_price_configuration()
    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
        user,
        selection,
    )
    refill_shape = _idempotency_shape_suffix(
        settings.stripe_refill_10h_price_id,
        success_url,
        cancel_url,
    )
    try:
        checkout = await stripe_billing.create_refill_checkout_session(
            stripe_customer_id=stripe_customer_id,
            billing_subject_id=str(subject_id),
            refill_price_id=settings.stripe_refill_10h_price_id,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=f"refill-10h:{subject_id}:{refill_shape}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingUrlResponse(url=checkout.url)


async def create_customer_portal_session(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection | None = None,
    return_surface: BillingReturnSurface = "web",
) -> BillingUrlResponse:
    _success_url, _cancel_url, portal_return_url = _require_redirect_urls(return_surface)
    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
        user,
        owner_selection or OwnerSelection(),
    )
    try:
        portal = await stripe_billing.create_customer_portal_session(
            stripe_customer_id=stripe_customer_id,
            return_url=portal_return_url,
            idempotency_key=f"portal:{subject_id}:{_idempotency_shape_suffix(portal_return_url)}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingUrlResponse(url=portal.url)


async def update_overage_settings(
    db: AsyncSession,
    user: AuthenticatedUser,
    *,
    enabled: bool,
    cap_cents_per_seat: int | None = None,
    owner_selection: OwnerSelection | None = None,
) -> OverageSettingsResponse:
    if cap_cents_per_seat is not None and not (
        0 <= cap_cents_per_seat <= PRO_OVERAGE_CAP_CENTS_PER_SEAT_MAX
    ):
        raise BillingServiceError(
            "invalid_overage_cap",
            "Overage cap must be between 0 and 1000000 cents per seat.",
            status_code=400,
        )
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "personal":
        subject = await set_overage_policy_for_user(
            db,
            user_id=user.id,
            overage_enabled=enabled,
            overage_cap_cents_per_seat=cap_cents_per_seat,
        )
    else:
        context = await _resolve_billing_owner_context(db, user, selection)
        try:
            require_org_role(context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
        except ProliferateError as error:
            raise BillingServiceError(
                error.code,
                error.message,
                status_code=error.status_code,
            ) from error
        subject = await set_overage_policy_for_subject(
            db,
            billing_subject_id=context.billing_subject_id,
            overage_enabled=enabled,
            overage_cap_cents_per_seat=cap_cents_per_seat,
        )
    return OverageSettingsResponse(
        overage_enabled=enabled,
        overage_cap_cents_per_seat=subject.overage_cap_cents_per_seat,
    )


async def state_with_overage_usage(
    db: AsyncSession,
    state: BillingSnapshotState,
) -> BillingSnapshotState:
    return await billing_snapshots.state_with_overage_usage(db, state)


async def account_usage_for_billing_subject(
    *,
    billing_subject_id: UUID,
    is_paid_cloud: bool,
    billing_subscription_id: UUID | None,
    period_start: datetime | None,
    period_end: datetime | None,
    overage_enabled: bool,
    billing_mode: str,
    overage_cap_cents: int | None = None,
    consume_grants: bool = True,
    export_overage: bool = True,
    scan_until: datetime | None = None,
) -> BillingAccountingResult:
    return await billing_accounting_service.account_usage_for_billing_subject(
        billing_subject_id=billing_subject_id,
        is_paid_cloud=is_paid_cloud,
        billing_subscription_id=billing_subscription_id,
        period_start=period_start,
        period_end=period_end,
        overage_enabled=overage_enabled,
        billing_mode=billing_mode,
        overage_cap_cents=overage_cap_cents,
        consume_grants=consume_grants,
        export_overage=export_overage,
        scan_until=scan_until,
    )


async def claim_usage_exports_for_sending(*, limit: int = 100) -> list[ClaimedUsageExport]:
    return await billing_accounting_service.claim_usage_exports_for_sending(limit=limit)


async def run_billing_accounting_pass(*, subject_limit: int = 100) -> None:
    if settings.cloud_billing_mode not in {BILLING_MODE_OBSERVE, BILLING_MODE_ENFORCE}:
        return

    await process_pending_seat_adjustments()

    async with db_session.open_async_transaction() as db:
        subject_ids = await list_billing_subject_ids_for_usage_accounting(
            db,
            limit=subject_limit,
        )
    for billing_subject_id in subject_ids:
        async with db_session.open_async_transaction() as db:
            state = await snapshot_state.load_snapshot_state_for_subject(db, billing_subject_id)
            state = await state_with_overage_usage(db, state)
        now = utcnow()
        unlimited_state = _compute_unlimited_cloud_hours_state(
            subscriptions=state.subscriptions,
            entitlements=state.entitlements,
            now=now,
        )
        results = []
        pro_subscription = (
            unlimited_state.subscription
            if (
                settings.pro_billing_enabled
                and unlimited_state.subscription is not None
                and _subscription_is_pro(unlimited_state.subscription)
            )
            else None
        )
        if unlimited_state.has_unlimited_cloud_hours:
            if unlimited_state.unlimited_window_start is not None:
                results.append(
                    await billing_accounting_service.account_usage_for_snapshot_state(
                        state,
                        scan_until=unlimited_state.unlimited_window_start,
                        consume_grants=True,
                        subscription=None,
                    )
                )
            results.append(
                await billing_accounting_service.account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=False,
                    subscription=None,
                )
            )
        elif pro_subscription is not None:
            results.append(
                await billing_accounting_service.account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=pro_subscription,
                )
            )
        else:
            results.append(
                await billing_accounting_service.account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=None,
                )
            )

        if any(result.export_count > 0 for result in results):
            snapshot = _build_billing_snapshot(state)
            async with db_session.open_async_transaction() as db:
                await record_billing_decision_event(
                    db,
                    billing_subject_id=billing_subject_id,
                    actor_user_id=None,
                    workspace_id=None,
                    decision_type=BILLING_DECISION_OVERAGE_EXPORT,
                    mode=settings.cloud_billing_mode,
                    would_block_start=False,
                    would_pause_active=False,
                    reason=(
                        BILLING_USAGE_EXPORT_STATUS_OBSERVED
                        if settings.cloud_billing_mode == BILLING_MODE_OBSERVE
                        else "pending"
                    ),
                    active_sandbox_count=snapshot.active_sandbox_count,
                    remaining_seconds=snapshot.remaining_seconds,
                )

    if settings.cloud_billing_mode == BILLING_MODE_ENFORCE:
        await send_pending_usage_exports()


async def process_pending_seat_adjustments(*, limit: int = 100) -> None:
    await billing_accounting_service.process_pending_seat_adjustments(limit=limit)


async def send_pending_usage_exports(*, limit: int = 100) -> None:
    await billing_accounting_service.send_pending_usage_exports(limit=limit)
