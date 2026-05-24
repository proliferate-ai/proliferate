"""Billing service layer."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import math
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import OwnerContext, OwnerSelection, require_org_role
from proliferate.config import settings
from proliferate.constants.billing import (
    ACTIVE_SANDBOX_STATUSES,
    BILLING_DECISION_AUTHORIZE_START,
    BILLING_DECISION_OVERAGE_EXPORT,
    BILLING_MODE_ENFORCE,
    BILLING_MODE_OBSERVE,
    BILLING_MODE_OFF,
    BILLING_PLAN_FREE,
    BILLING_PLAN_PRO,
    BILLING_PRICE_CLASS_PRO,
    BILLING_SUBJECT_KIND_PERSONAL,
    BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL,
    BILLING_USAGE_EXPORT_STATUS_OBSERVED,
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS,
    FREE_CLOUD_ALLOCATION_KIND_PERSONAL_TRIAL,
    FREE_CLOUD_ALLOCATION_PERIOD_V2,
    FREE_INCLUDED_GRANT_TYPE,
    FREE_TRIAL_V2_GRANT_TYPE,
    PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_SEAT,
    PRO_FREE_TRIAL_HOURS,
    PRO_OVERAGE_CAP_CENTS_PER_SEAT_MAX,
    PRO_OVERAGE_PRICE_PER_HOUR_CENTS,
    PRO_SEAT_PRORATION_GRANT_TYPE,
    WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT,
    WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED,
    WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED,
)
from proliferate.constants.organizations import (
    ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BILLING_STATE,
    ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BUSINESS_STATE,
    ORGANIZATION_CHECKOUT_INTENT_STATUS_PENDING,
    ORGANIZATION_INVITE_EXPIRES_DAYS,
    ORGANIZATION_INVITE_TOKEN_DOMAIN,
    ORGANIZATION_ROLE_ADMIN,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_PENDING_CHECKOUT,
)
from proliferate.db import engine as db_engine
from proliferate.db.models.auth import User
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingGrant,
    BillingHold,
    BillingSubscription,
    UsageSegment,
)
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store.billing import (
    BillingAccountingResult,
    BillingSnapshotState,
    BillingSubjectStripeState,
    FreeCloudAllocationEnsureOutcome,
    account_usage_for_billing_subject,
    bind_stripe_customer_to_billing_subject,
    claim_pending_seat_adjustments,
    claim_usage_exports_for_sending,
    count_active_seats_for_billing_subject_id,
    ensure_billing_grant_record,
    ensure_free_cloud_allocation_outcome,
    ensure_personal_billing_subject,
    get_billing_snapshot_state_for_subject,
    get_billing_snapshot_state_for_user,
    get_existing_billing_snapshot_state_for_user,
    get_free_cloud_allocation_for_github_identity,
    get_free_cloud_allocation_for_user,
    get_linked_github_provider_user_id,
    get_or_create_organization_stripe_customer_state,
    get_or_create_user_stripe_customer_state,
    list_billing_notification_events_for_subject,
    list_billing_subject_ids_for_usage_accounting,
    load_billing_snapshot_state,
    load_billing_snapshot_state_for_subject,
    mark_seat_adjustment_failed,
    mark_seat_adjustment_grant_issued,
    mark_seat_adjustment_stripe_confirmed,
    mark_usage_export_failed,
    mark_usage_export_succeeded,
    maybe_create_org_seat_adjustment,
    record_billing_decision_event,
    record_billing_notification_event,
    resolve_billing_subject_id_for_workspace,
    set_overage_policy_for_subject,
    set_overage_policy_for_user,
    upsert_billing_subscription,
)
from proliferate.db.store.cloud_agent_auth.records import AgentGatewayBudgetSubjectRecord
from proliferate.db.store.organization_records import (
    CheckoutIntentRecord,
    CheckoutIntentWithOrganizationRecord,
    OrganizationWithMembershipRecord,
)
from proliferate.db.store.organizations import (
    acquire_membership_activation_lock,
    bind_team_checkout_session,
    cancel_team_checkout_intent,
    complete_team_checkout_activation,
    create_pending_team_checkout_intent,
    get_current_membership_for_user,
    get_current_team_checkout_intent,
    get_organization_with_membership,
    load_organization_by_billing_subject,
    load_team_checkout_intent_for_update,
    mark_team_checkout_activating,
    mark_team_checkout_failed,
)
from proliferate.errors import ProliferateError
from proliferate.integrations import resend
from proliferate.integrations.billing import stripe as stripe_billing
from proliferate.server.billing.domain.accounting import (
    stripe_status_is_terminal,
    terminal_meter_event_error,
    usage_export_identifier,
)
from proliferate.server.billing.domain.plans import (
    BillingPlanRuleConfig,
    UnlimitedCloudHoursState,
    active_hold_reason,
    authorization_message,
    compute_unlimited_cloud_hours_state,
    grant_applies_to_paid_state,
    grant_is_active,
    repo_limit_for_billing_state,
    subscription_in_rollover_grace,
    subscription_is_pro,
)
from proliferate.server.billing.domain.pricing import (
    monthly_subscription_price_ids,
    overage_subscription_price_ids,
)
from proliferate.server.billing.domain.webhooks import (
    id_from_expandable as _stripe_id_from_expandable,
)
from proliferate.server.billing.domain.webhooks import (
    metadata as _stripe_metadata,
)
from proliferate.server.billing.domain.webhooks import (
    subscription_item_details as _stripe_subscription_item_details,
)
from proliferate.server.billing.domain.webhooks import (
    subscription_period as _stripe_subscription_period,
)
from proliferate.server.billing.models import (
    AccountCreditsEnsureOutcome,
    BillingOverview,
    BillingServiceError,
    BillingSnapshot,
    BillingUrlResponse,
    CloudPlanInfo,
    CurrentTeamCheckoutResponse,
    OverageSettingsResponse,
    PlanInfo,
    SandboxStartAuthorization,
    TeamCheckoutIntentResponse,
    TeamCheckoutResponse,
    coerce_utc,
    duration_seconds,
    utcnow,
)
from proliferate.server.billing.policy import free_v2_policy, pro_policy, unlimited_numeric_policy
from proliferate.server.billing.pricing import (
    billing_price_ids_from_settings,
    classify_monthly_price_id,
    configured_managed_cloud_meter_event_name,
    configured_managed_cloud_overage_price_id,
    configured_pro_monthly_price_id,
)
from proliferate.server.billing.seats import (
    prorated_seat_grant_hours,
    seat_proration_grant_source_ref,
)
from proliferate.server.cloud.sandbox_profiles.service import ensure_organization_for_activation
from proliferate.server.organizations.domain.profile import (
    clean_organization_name,
    derive_logo_domain_from_email,
    organization_name_issue,
)

logger = logging.getLogger("proliferate.billing.service")

_ACCOUNT_FREE_LLM_CREDIT_SOURCE = "signup_free_credit"


async def _mark_team_checkout_failed_with_event(
    db: AsyncSession,
    intent: object,
    *,
    organization_id: UUID,
    activation_status: str,
    error_code: str,
    error_message: str,
    webhook_event_id: str | None,
) -> None:
    failed = await mark_team_checkout_failed(
        db,
        intent,  # type: ignore[arg-type]
        activation_status=activation_status,
        error_code=error_code,
        error_message=error_message,
        webhook_event_id=webhook_event_id,
    )
    await record_billing_notification_event(
        db,
        billing_subject_id=failed.billing_subject_id,
        organization_id=organization_id,
        user_id=failed.created_by_user_id,
        kind="checkout_failed",
        severity="error",
        source="stripe" if webhook_event_id else "billing",
        external_ref=webhook_event_id,
        idempotency_key=f"checkout_failed:{failed.id}:{error_code}",
        payload_json={
            "activation_status": activation_status,
            "error_code": error_code,
            "error_message": error_message,
        },
        occurred_at=utcnow(),
    )


@dataclass(frozen=True)
class AccountFreeCloudCreditsRecord:
    included_hours: float
    used_hours: float
    remaining_hours: float
    status: str


@dataclass(frozen=True)
class AccountFreeLlmReadyAgentModelRecord:
    agent_kind: str
    model_id: str


@dataclass(frozen=True)
class AccountFreeLlmCreditsRecord:
    enabled: bool
    status: str
    included_budget_usd: str
    period_key: str
    launch_enabled: bool
    ready_agent_models: tuple[AccountFreeLlmReadyAgentModelRecord, ...]
    last_error_code: str | None
    last_error_message: str | None


@dataclass(frozen=True)
class AccountCreditsOverviewRecord:
    billing_subject_id: UUID | None
    free_cloud: AccountFreeCloudCreditsRecord
    free_llm: AccountFreeLlmCreditsRecord
    github_required: bool
    free_allocation_status: str
    start_blocked: bool
    start_block_reason: str | None
    blocked_resource: str | None


@dataclass(frozen=True)
class AccountCreditsEnsureRecord:
    account_credits: AccountCreditsOverviewRecord
    free_allocation_outcome: AccountCreditsEnsureOutcome
    free_allocation_blocked_reason: str | None


@dataclass(frozen=True)
class TeamManagedCloudBillingRecord:
    included_hours: float | None
    used_hours: float
    remaining_hours: float | None
    overage_enabled: bool
    overage_cap_cents: int | None
    overage_used_cents: int


@dataclass(frozen=True)
class TeamManagedLlmBillingRecord:
    included_budget_usd: str | None
    status: str
    period_key: str | None
    litellm_sync_status: str | None
    last_error_code: str | None


@dataclass(frozen=True)
class TeamBillingOverviewRecord:
    organization_id: UUID
    name: str
    role: str
    can_manage_billing: bool
    plan: str
    subscription_status: str | None
    payment_healthy: bool
    seat_quantity: int | None
    active_member_count: int
    current_period_start: datetime | None
    current_period_end: datetime | None
    hosted_invoice_url: str | None
    managed_cloud: TeamManagedCloudBillingRecord
    managed_llm: TeamManagedLlmBillingRecord
    start_blocked: bool
    start_block_reason: str | None
    blocked_resource: str | None


@dataclass(frozen=True)
class TeamBillingEnvelopeRecord:
    team: TeamBillingOverviewRecord | None
    can_create_team: bool
    pending_checkout: TeamCheckoutIntentResponse | None


@dataclass(frozen=True)
class BillingEventSummaryRecord:
    id: UUID
    kind: str
    severity: str
    occurred_at: datetime
    recorded_at: datetime
    summary: str
    stripe_object_id: str | None


def _billing_plan_rule_config() -> BillingPlanRuleConfig:
    return BillingPlanRuleConfig(
        pro_billing_enabled=settings.pro_billing_enabled,
        cloud_monthly_price_id=settings.stripe_cloud_monthly_price_id,
        price_ids=billing_price_ids_from_settings(),
    )


def _grant_is_active(grant: BillingGrant, now: datetime) -> bool:
    return grant_is_active(grant, now)


def _compute_unlimited_cloud_hours_state(
    *,
    subscriptions: list[BillingSubscription],
    entitlements: list[BillingEntitlement],
    now: datetime,
) -> UnlimitedCloudHoursState:
    return compute_unlimited_cloud_hours_state(
        subscriptions=subscriptions,
        entitlements=entitlements,
        now=now,
        config=_billing_plan_rule_config(),
    )


def _hold_reason(holds: list[BillingHold]) -> str | None:
    return active_hold_reason(holds)


def _subscription_is_pro(subscription: BillingSubscription) -> bool:
    return subscription_is_pro(subscription, config=_billing_plan_rule_config())


def _subscription_in_rollover_grace(
    subscription: BillingSubscription | None,
    now: datetime,
) -> bool:
    return subscription_in_rollover_grace(subscription, now)


def repo_limit_for_billing_snapshot(snapshot: BillingSnapshot) -> int | None:
    return repo_limit_for_billing_state(
        billing_mode=snapshot.billing_mode,
        pro_billing_enabled=settings.pro_billing_enabled,
        is_paid_cloud=snapshot.is_paid_cloud,
        has_unlimited_cloud_hours=snapshot.has_unlimited_cloud_hours,
        repo_environment_limit=snapshot.repo_environment_limit,
        paid_cloud_repo_limit=settings.cloud_paid_repo_limit,
        free_cloud_repo_limit=settings.cloud_free_repo_limit,
    )


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
    return await maybe_create_org_seat_adjustment(
        db,
        organization_id=organization_id,
        membership_id=membership_id,
    )


def _grant_applies_to_paid_state(grant: BillingGrant, *, is_paid_cloud: bool) -> bool:
    return grant_applies_to_paid_state(
        grant.grant_type,
        is_paid_cloud=is_paid_cloud,
        pro_billing_enabled=settings.pro_billing_enabled,
    )


def _segment_seconds(segment: UsageSegment, now: datetime) -> float:
    return duration_seconds(
        started_at=segment.started_at,
        ended_at=segment.ended_at,
        now=now,
    )


async def get_billing_snapshot(user_id: UUID) -> BillingSnapshot:
    state = await load_billing_snapshot_state(user_id)
    return _build_billing_snapshot(state)


async def get_billing_snapshot_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshot:
    return await _get_billing_snapshot_for_request(db, user_id)


async def get_billing_snapshot_for_subject(billing_subject_id: UUID) -> BillingSnapshot:
    state = await load_billing_snapshot_state_for_subject(billing_subject_id)
    return _build_billing_snapshot(state)


async def get_billing_snapshot_for_subject_in_session(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshot:
    state = await get_billing_snapshot_state_for_subject(db, billing_subject_id)
    return _build_billing_snapshot(state)


async def _get_billing_snapshot_for_request(
    db: AsyncSession,
    user_id: UUID,
) -> BillingSnapshot:
    state = await get_billing_snapshot_state_for_user(db, user_id)
    return _build_billing_snapshot(state)


async def _get_billing_snapshot_for_subject_request(
    db: AsyncSession,
    billing_subject_id: UUID,
) -> BillingSnapshot:
    state = await get_billing_snapshot_state_for_subject(db, billing_subject_id)
    return _build_billing_snapshot(state)


def _build_billing_snapshot(state: BillingSnapshotState) -> BillingSnapshot:
    now = utcnow()
    used_seconds = state.historical_billable_seconds + sum(
        _segment_seconds(segment, now) for segment in state.usage_segments
    )
    unlimited_state = _compute_unlimited_cloud_hours_state(
        subscriptions=state.subscriptions,
        entitlements=state.entitlements,
        now=now,
    )
    healthy_subscription = unlimited_state.subscription
    is_pro_subscription = (
        settings.pro_billing_enabled
        and healthy_subscription is not None
        and _subscription_is_pro(healthy_subscription)
    )
    active_manual_unlimited = unlimited_state.manual_entitlement is not None
    is_paid_cloud = healthy_subscription is not None
    payment_healthy = is_paid_cloud
    eligible_grants = [
        grant
        for grant in state.grants
        if _grant_applies_to_paid_state(grant, is_paid_cloud=is_paid_cloud)
    ]
    active_grants = [grant for grant in eligible_grants if _grant_is_active(grant, now)]
    included_seconds = sum(max(grant.hours_granted * 3600.0, 0.0) for grant in active_grants)
    stored_remaining_seconds = sum(
        max(float(grant.remaining_seconds), 0.0) for grant in active_grants
    )
    remaining_seconds = max(
        stored_remaining_seconds - state.unaccounted_billable_seconds,
        0.0,
    )

    has_unlimited_cloud_hours = unlimited_state.has_unlimited_cloud_hours
    remaining_seconds_value = None if has_unlimited_cloud_hours else max(remaining_seconds, 0.0)

    active_sandbox_count = sum(
        1 for sandbox in state.sandboxes if sandbox.status in ACTIVE_SANDBOX_STATUSES
    )

    if settings.pro_billing_enabled:
        if is_pro_subscription:
            numeric_policy = pro_policy(
                billable_seat_count=state.active_seat_count,
                overage_cap_cents_per_seat=state.subject.overage_cap_cents_per_seat,
            )
        elif has_unlimited_cloud_hours:
            numeric_policy = unlimited_numeric_policy(byo_runtime_allowed=True)
        else:
            numeric_policy = free_v2_policy()
    else:
        numeric_policy = None

    rollover_grace = _subscription_in_rollover_grace(healthy_subscription, now)
    over_quota = not has_unlimited_cloud_hours and remaining_seconds <= 0 and not rollover_grace
    managed_cloud_overage_cap_cents = (
        numeric_policy.managed_cloud_overage_cap_cents if numeric_policy is not None else None
    )
    cap_exhausted = (
        is_pro_subscription
        and managed_cloud_overage_cap_cents is not None
        and state.managed_cloud_overage_used_cents >= managed_cloud_overage_cap_cents
    )
    paid_overage_allowed = (
        not has_unlimited_cloud_hours
        and is_paid_cloud
        and state.subject.overage_enabled
        and payment_healthy
        and not cap_exhausted
    )
    concurrent_sandbox_limit = (
        numeric_policy.active_environment_limit
        if numeric_policy is not None
        else (None if is_paid_cloud else settings.cloud_concurrent_sandbox_limit)
    )
    concurrency_limited = (
        concurrent_sandbox_limit is not None and active_sandbox_count >= concurrent_sandbox_limit
    )
    hold_reason = _hold_reason(state.holds)
    credit_reason = None
    if over_quota and not paid_overage_allowed:
        if is_pro_subscription and not state.subject.overage_enabled:
            credit_reason = WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED
        elif is_pro_subscription and cap_exhausted:
            credit_reason = WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED
        else:
            credit_reason = WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED
    concurrency_reason = (
        WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT if concurrency_limited else None
    )
    start_block_reason = hold_reason or credit_reason or concurrency_reason
    active_spend_hold_reason = hold_reason or credit_reason
    start_blocked = start_block_reason is not None
    active_spend_hold = active_spend_hold_reason is not None
    legacy_cloud_subscription = (
        unlimited_state.legacy_cloud_subscription and settings.pro_billing_enabled
    )
    if settings.pro_billing_enabled:
        plan = (
            BILLING_PLAN_PRO if (is_paid_cloud or active_manual_unlimited) else BILLING_PLAN_FREE
        )
        cloud_repo_limit = (
            numeric_policy.repo_environment_limit if numeric_policy is not None else None
        )
        billable_seat_count = (
            numeric_policy.billable_seat_count if numeric_policy is not None else None
        )
        included_managed_cloud_hours = (
            numeric_policy.included_managed_cloud_hours if numeric_policy is not None else None
        )
        remaining_managed_cloud_hours = (
            remaining_seconds_value / 3600.0
            if included_managed_cloud_hours is not None and remaining_seconds_value is not None
            else None
        )
        repo_environment_limit = (
            numeric_policy.repo_environment_limit if numeric_policy is not None else None
        )
        active_environment_limit = (
            numeric_policy.active_environment_limit if numeric_policy is not None else None
        )
        byo_runtime_allowed = (
            numeric_policy.byo_runtime_allowed if numeric_policy is not None else False
        )
    else:
        plan = "cloud" if is_paid_cloud else ("unlimited" if active_manual_unlimited else "free")
        cloud_repo_limit = (
            settings.cloud_paid_repo_limit
            if is_paid_cloud or has_unlimited_cloud_hours
            else settings.cloud_free_repo_limit
        )
        billable_seat_count = None
        included_managed_cloud_hours = None
        remaining_managed_cloud_hours = None
        managed_cloud_overage_cap_cents = None
        repo_environment_limit = cloud_repo_limit
        active_environment_limit = concurrent_sandbox_limit
        byo_runtime_allowed = False

    return BillingSnapshot(
        billing_subject_id=state.billing_subject_id,
        plan=plan,
        billing_mode=settings.cloud_billing_mode,
        pro_billing_enabled=settings.pro_billing_enabled,
        is_unlimited=active_manual_unlimited,
        has_unlimited_cloud_hours=has_unlimited_cloud_hours,
        over_quota=over_quota,
        is_paid_cloud=is_paid_cloud,
        payment_healthy=payment_healthy,
        overage_enabled=state.subject.overage_enabled,
        overage_cap_cents_per_seat=state.subject.overage_cap_cents_per_seat,
        included_hours=None if has_unlimited_cloud_hours else included_seconds / 3600.0,
        used_hours=used_seconds / 3600.0,
        remaining_hours=(None if has_unlimited_cloud_hours else remaining_seconds_value / 3600.0),
        cloud_repo_limit=cloud_repo_limit,
        active_cloud_repo_count=state.active_cloud_repo_count,
        concurrent_sandbox_limit=concurrent_sandbox_limit,
        active_sandbox_count=active_sandbox_count,
        start_blocked=start_blocked,
        start_block_reason=start_block_reason,
        active_spend_hold=active_spend_hold,
        hold_reason=active_spend_hold_reason,
        remaining_seconds=remaining_seconds_value,
        hosted_invoice_url=(
            healthy_subscription.hosted_invoice_url if healthy_subscription is not None else None
        ),
        billable_seat_count=billable_seat_count,
        included_managed_cloud_hours=included_managed_cloud_hours,
        remaining_managed_cloud_hours=remaining_managed_cloud_hours,
        managed_cloud_overage_enabled=state.subject.overage_enabled,
        managed_cloud_overage_cap_cents=managed_cloud_overage_cap_cents,
        managed_cloud_overage_used_cents=(
            0 if has_unlimited_cloud_hours else state.managed_cloud_overage_used_cents
        ),
        overage_price_per_hour_cents=PRO_OVERAGE_PRICE_PER_HOUR_CENTS,
        active_environment_limit=active_environment_limit,
        repo_environment_limit=repo_environment_limit,
        byo_runtime_allowed=byo_runtime_allowed,
        legacy_cloud_subscription=legacy_cloud_subscription,
    )


def _authorization_message(reason: str | None) -> str | None:
    return authorization_message(reason)


async def authorize_sandbox_start_for_billing_subject(
    *,
    actor_user_id: UUID | None,
    billing_subject_id: UUID,
    workspace_id: UUID | None = None,
) -> SandboxStartAuthorization:
    snapshot = await get_billing_snapshot_for_subject(billing_subject_id)
    return await _record_sandbox_start_authorization(
        snapshot,
        actor_user_id=actor_user_id,
        workspace_id=workspace_id,
    )


async def authorize_sandbox_start(
    *,
    user_id: UUID,
    workspace_id: UUID | None,
) -> SandboxStartAuthorization:
    if workspace_id is None:
        snapshot = await get_billing_snapshot(user_id)
    else:
        billing_subject_id = await resolve_billing_subject_id_for_workspace(workspace_id)
        snapshot = await get_billing_snapshot_for_subject(billing_subject_id)
    return await _record_sandbox_start_authorization(
        snapshot,
        actor_user_id=user_id,
        workspace_id=workspace_id,
    )


async def _record_sandbox_start_authorization(
    snapshot: BillingSnapshot,
    *,
    actor_user_id: UUID | None,
    workspace_id: UUID | None,
) -> SandboxStartAuthorization:
    enforced = settings.cloud_billing_mode == BILLING_MODE_ENFORCE
    allowed = not enforced or not snapshot.start_blocked
    reason = snapshot.start_block_reason if snapshot.start_blocked else None
    await record_billing_decision_event(
        billing_subject_id=snapshot.billing_subject_id,
        actor_user_id=actor_user_id,
        workspace_id=workspace_id,
        decision_type=BILLING_DECISION_AUTHORIZE_START,
        mode=settings.cloud_billing_mode,
        would_block_start=snapshot.start_blocked,
        would_pause_active=snapshot.active_spend_hold,
        reason=reason,
        active_sandbox_count=snapshot.active_sandbox_count,
        remaining_seconds=snapshot.remaining_seconds,
    )
    return SandboxStartAuthorization(
        allowed=allowed,
        billing_subject_id=snapshot.billing_subject_id,
        start_blocked=snapshot.start_blocked,
        start_block_reason=snapshot.start_block_reason,
        active_spend_hold=snapshot.active_spend_hold,
        hold_reason=snapshot.hold_reason,
        message=_authorization_message(reason),
        active_sandbox_count=snapshot.active_sandbox_count,
        remaining_seconds=snapshot.remaining_seconds,
        active_environment_limit=snapshot.active_environment_limit,
    )


async def get_billing_overview(db: AsyncSession, user_id: UUID) -> BillingOverview:
    snapshot = await _get_billing_snapshot_for_request(db, user_id)
    return _billing_overview_from_snapshot(snapshot)


async def get_billing_overview_for_owner(
    db: AsyncSession,
    user: User,
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
    user: User,
    owner_selection: OwnerSelection,
) -> CloudPlanInfo:
    context = await _resolve_billing_owner_context(db, user, owner_selection)
    snapshot = await _get_billing_snapshot_for_subject_request(db, context.billing_subject_id)
    return _cloud_plan_from_snapshot(snapshot)


async def get_account_credits_overview(
    db: AsyncSession,
    user: User,
) -> AccountCreditsOverviewRecord:
    return await _account_credits_overview_record(db, user)


async def ensure_account_credits(
    db: AsyncSession,
    user: User,
) -> AccountCreditsEnsureRecord:
    subject = await ensure_personal_billing_subject(db, user.id)
    allocation_result = None
    if settings.pro_billing_enabled:
        allocation_result = await ensure_free_cloud_allocation_outcome(
            db,
            allocation_kind=FREE_CLOUD_ALLOCATION_KIND_PERSONAL_TRIAL,
            subject=subject,
            period_key=FREE_CLOUD_ALLOCATION_PERIOD_V2,
        )
    elif _account_free_llm_enabled():
        allocation_result = await ensure_free_cloud_allocation_outcome(
            db,
            allocation_kind=FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS,
            subject=subject,
            period_key=_account_free_llm_period_key(),
        )
    await get_billing_snapshot_state_for_user(db, user.id)
    free_llm_result = None
    if _account_free_llm_enabled():
        try:
            from proliferate.server.cloud.agent_auth.errors import AgentAuthError
            from proliferate.server.cloud.agent_auth.models import (
                EnsureFreeManagedCreditsRequest,
            )
            from proliferate.server.cloud.agent_auth.service import (
                ensure_free_managed_credits_for_user,
            )

            free_llm_result = await ensure_free_managed_credits_for_user(
                db,
                actor_user_id=user.id,
                body=EnsureFreeManagedCreditsRequest(),
            )
        except AgentAuthError as error:
            logger.warning(
                "Failed to ensure account free managed credits",
                extra={"user_id": str(user.id), "error": str(error)},
            )
    account_credits = await _account_credits_overview_record(
        db,
        user,
        free_llm_result=free_llm_result,
        mutation_snapshot=True,
    )
    outcome = _account_credits_outcome(allocation_result.outcome if allocation_result else None)
    return AccountCreditsEnsureRecord(
        account_credits=account_credits,
        free_allocation_outcome=outcome,
        free_allocation_blocked_reason=(
            allocation_result.blocked_reason if allocation_result is not None else None
        ),
    )


async def get_team_billing_overview(
    db: AsyncSession,
    user: User,
) -> TeamBillingEnvelopeRecord:
    membership = await get_current_membership_for_user(db, user.id)
    pending = await get_current_team_checkout_intent(db, user.id)
    if membership is None:
        return TeamBillingEnvelopeRecord(
            team=None,
            can_create_team=True,
            pending_checkout=(
                _team_checkout_intent_response(pending) if pending is not None else None
            ),
        )
    state = await get_or_create_organization_stripe_customer_state(
        db,
        membership.organization.id,
    )
    snapshot_state = await get_billing_snapshot_state_for_subject(db, state.billing_subject_id)
    snapshot = _build_billing_snapshot(snapshot_state)
    subscription = _current_subscription(snapshot_state.subscriptions)
    can_manage_billing = membership.membership.role in {
        ORGANIZATION_ROLE_OWNER,
        ORGANIZATION_ROLE_ADMIN,
    }
    budget = await _team_managed_llm_budget(db, membership.organization.id)
    return TeamBillingEnvelopeRecord(
        team=TeamBillingOverviewRecord(
            organization_id=membership.organization.id,
            name=membership.organization.name,
            role=membership.membership.role,
            can_manage_billing=can_manage_billing,
            plan=(
                "team"
                if snapshot.is_paid_cloud or snapshot.plan == BILLING_PLAN_PRO
                else snapshot.plan
            ),
            subscription_status=subscription.status if subscription is not None else None,
            payment_healthy=snapshot.payment_healthy,
            seat_quantity=(
                subscription.seat_quantity
                if subscription is not None
                else snapshot_state.active_seat_count
            ),
            active_member_count=snapshot_state.active_seat_count,
            current_period_start=(
                subscription.current_period_start if subscription is not None else None
            ),
            current_period_end=(
                subscription.current_period_end if subscription is not None else None
            ),
            hosted_invoice_url=snapshot.hosted_invoice_url if can_manage_billing else None,
            managed_cloud=TeamManagedCloudBillingRecord(
                included_hours=snapshot.included_managed_cloud_hours or snapshot.included_hours,
                used_hours=snapshot.used_hours,
                remaining_hours=(
                    snapshot.remaining_managed_cloud_hours or snapshot.remaining_hours
                ),
                overage_enabled=snapshot.managed_cloud_overage_enabled,
                overage_cap_cents=snapshot.managed_cloud_overage_cap_cents,
                overage_used_cents=snapshot.managed_cloud_overage_used_cents,
            ),
            managed_llm=TeamManagedLlmBillingRecord(
                included_budget_usd=budget.included_budget_usd if budget is not None else None,
                status=_managed_llm_status(budget),
                period_key=budget.entitlement_period_key if budget is not None else None,
                litellm_sync_status=budget.litellm_sync_status if budget is not None else None,
                last_error_code=budget.last_error_code if budget is not None else None,
            ),
            start_blocked=snapshot.start_blocked,
            start_block_reason=_facade_block_reason(snapshot.start_block_reason),
            blocked_resource=_blocked_resource(snapshot.start_block_reason),
        ),
        can_create_team=False,
        pending_checkout=None,
    )


async def create_team_billing_portal_session(
    db: AsyncSession,
    user: User,
) -> BillingUrlResponse:
    membership = await _require_current_team_membership(db, user)
    return await create_customer_portal_session(
        db,
        user,
        OwnerSelection(
            owner_scope="organization",
            organization_id=membership.organization.id,
        ),
    )


async def update_team_overage_settings(
    db: AsyncSession,
    user: User,
    *,
    enabled: bool,
    cap_cents_per_seat: int | None = None,
) -> OverageSettingsResponse:
    membership = await _require_current_team_membership(db, user)
    return await update_overage_settings(
        db,
        user,
        enabled=enabled,
        cap_cents_per_seat=cap_cents_per_seat,
        owner_selection=OwnerSelection(
            owner_scope="organization",
            organization_id=membership.organization.id,
        ),
    )


async def list_team_billing_events(
    db: AsyncSession,
    user: User,
) -> tuple[BillingEventSummaryRecord, ...]:
    membership = await get_current_membership_for_user(db, user.id)
    if membership is None:
        return ()
    state = await get_or_create_organization_stripe_customer_state(
        db,
        membership.organization.id,
    )
    can_manage_billing = membership.membership.role in {
        ORGANIZATION_ROLE_OWNER,
        ORGANIZATION_ROLE_ADMIN,
    }
    if not can_manage_billing:
        return ()
    events = await list_billing_notification_events_for_subject(
        db,
        billing_subject_id=state.billing_subject_id,
    )
    return tuple(
        BillingEventSummaryRecord(
            id=event.id,
            kind=event.kind,
            severity=event.severity,
            occurred_at=event.occurred_at,
            recorded_at=event.created_at,
            summary=_billing_event_summary(event.kind),
            stripe_object_id=(
                event.external_ref
                if can_manage_billing and event.source == "stripe"
                else None
            ),
        )
        for event in events
    )


def _account_credits_outcome(
    outcome: FreeCloudAllocationEnsureOutcome | None,
) -> AccountCreditsEnsureOutcome:
    if outcome is None:
        return AccountCreditsEnsureOutcome.NOT_APPLICABLE
    return AccountCreditsEnsureOutcome(outcome.value)


def _account_free_llm_period_key() -> str:
    period = settings.agent_gateway_user_free_credit_period.strip() or "registration"
    if period == "monthly":
        return utcnow().strftime("%Y-%m")
    return "registration"


def _budget_amount_or_zero(raw_value: str) -> str:
    try:
        amount = Decimal(raw_value)
    except (InvalidOperation, TypeError):
        return "0"
    if amount < 0:
        return "0"
    return format(amount, "f")


def _account_free_llm_enabled() -> bool:
    budget = Decimal(_budget_amount_or_zero(settings.agent_gateway_user_free_credit_usd))
    return (
        settings.agent_gateway_enabled
        and settings.agent_gateway_user_free_credit_enabled
        and budget > 0
    )


def _managed_credit_agent_kinds_for_billing() -> tuple[str, ...]:
    configured = [
        item.strip()
        for item in settings.agent_gateway_managed_credit_agent_kinds.split(",")
        if item.strip()
    ]
    agent_kinds = tuple(
        item for item in configured if item in {"claude", "codex", "opencode", "gemini"}
    )
    return agent_kinds or ("claude",)


def _managed_credit_ready_models() -> tuple[AccountFreeLlmReadyAgentModelRecord, ...]:
    models: list[AccountFreeLlmReadyAgentModelRecord] = []
    for agent_kind in _managed_credit_agent_kinds_for_billing():
        if agent_kind == "claude":
            models.append(
                AccountFreeLlmReadyAgentModelRecord(
                    agent_kind=agent_kind,
                    model_id="us.anthropic.claude-sonnet-4-6",
                )
            )
    return tuple(models)


async def _account_credits_overview_record(
    db: AsyncSession,
    user: User,
    *,
    free_llm_result: object | None = None,
    mutation_snapshot: bool = False,
) -> AccountCreditsOverviewRecord:
    state = (
        await get_billing_snapshot_state_for_user(db, user.id)
        if mutation_snapshot
        else await get_existing_billing_snapshot_state_for_user(db, user.id)
    )
    snapshot = _build_billing_snapshot(state) if state is not None else None
    if snapshot is None:
        included_hours = (
            PRO_FREE_TRIAL_HOURS
            if settings.pro_billing_enabled
            else settings.cloud_free_sandbox_hours
        )
        used_hours = 0.0
        remaining_hours = max(included_hours, 0.0)
        billing_subject_id = None
        start_blocked = False
        start_block_reason = None
    else:
        included_hours = snapshot.included_hours or 0.0
        used_hours = snapshot.used_hours
        remaining_hours = snapshot.remaining_hours or 0.0
        billing_subject_id = snapshot.billing_subject_id
        start_blocked = snapshot.start_blocked
        start_block_reason = snapshot.start_block_reason

    allocation_status, github_required = await _account_free_allocation_status(
        db,
        user_id=user.id,
        remaining_hours=remaining_hours,
    )
    free_llm = await _account_free_llm_record(
        db,
        user_id=user.id,
        ensure_result=free_llm_result,
    )
    llm_blocked = free_llm.enabled and free_llm.status == "exhausted"
    account_start_reason = _facade_block_reason(start_block_reason)
    if not start_blocked and llm_blocked:
        start_blocked = True
        account_start_reason = "llm_credits_exhausted"
    return AccountCreditsOverviewRecord(
        billing_subject_id=billing_subject_id,
        free_cloud=AccountFreeCloudCreditsRecord(
            included_hours=included_hours,
            used_hours=used_hours,
            remaining_hours=remaining_hours,
            status="exhausted" if allocation_status == "exhausted" else allocation_status,
        ),
        free_llm=free_llm,
        github_required=github_required,
        free_allocation_status=allocation_status,
        start_blocked=start_blocked,
        start_block_reason=account_start_reason,
        blocked_resource=(
            "llm"
            if account_start_reason == "llm_credits_exhausted"
            else _blocked_resource(start_block_reason)
        ),
    )


async def _account_free_allocation_status(
    db: AsyncSession,
    *,
    user_id: UUID,
    remaining_hours: float,
) -> tuple[str, bool]:
    if settings.pro_billing_enabled:
        allocation_kind = FREE_CLOUD_ALLOCATION_KIND_PERSONAL_TRIAL
        period_key = FREE_CLOUD_ALLOCATION_PERIOD_V2
    elif _account_free_llm_enabled():
        allocation_kind = FREE_CLOUD_ALLOCATION_KIND_AGENT_GATEWAY_FREE_CREDITS
        period_key = _account_free_llm_period_key()
    else:
        return ("available", False)
    github_provider_user_id = await get_linked_github_provider_user_id(db, user_id)
    if github_provider_user_id is None:
        return ("requires_github", True)
    allocation = await get_free_cloud_allocation_for_user(
        db,
        user_id=user_id,
        allocation_kind=allocation_kind,
        period_key=period_key,
    )
    if allocation is not None:
        return ("exhausted" if remaining_hours <= 0 else "available", False)
    existing = await get_free_cloud_allocation_for_github_identity(
        db,
        github_provider_user_id=github_provider_user_id,
        allocation_kind=allocation_kind,
        period_key=period_key,
    )
    if existing is not None and existing.user_id != user_id:
        return ("already_allocated_elsewhere", True)
    return ("available", False)


async def _account_free_llm_record(
    db: AsyncSession,
    *,
    user_id: UUID,
    ensure_result: object | None = None,
) -> AccountFreeLlmCreditsRecord:
    period_key = _account_free_llm_period_key()
    included_budget_usd = _budget_amount_or_zero(settings.agent_gateway_user_free_credit_usd)
    if ensure_result is not None:
        ready_models = tuple(
            AccountFreeLlmReadyAgentModelRecord(
                agent_kind=model.agent_kind,
                model_id=public_model_name,
            )
            for model in ensure_result.ready_agent_models
            for public_model_name in model.public_model_names
        )
        return AccountFreeLlmCreditsRecord(
            enabled=_account_free_llm_enabled(),
            status=ensure_result.status,
            included_budget_usd=included_budget_usd,
            period_key=period_key,
            launch_enabled=ensure_result.launch_enabled,
            ready_agent_models=ready_models,
            last_error_code=ensure_result.last_error_code,
            last_error_message=ensure_result.last_error_message,
        )

    from proliferate.db.store.cloud_agent_auth import store as agent_auth_store

    entitlement = await agent_auth_store.get_free_credit_entitlement(
        db,
        user_id=user_id,
        source=_ACCOUNT_FREE_LLM_CREDIT_SOURCE,
        period_key=period_key,
    )
    budget = await agent_auth_store.get_user_managed_budget_subject(db, user_id)
    enabled = _account_free_llm_enabled()
    if not settings.agent_gateway_enabled:
        status = "gateway_disabled"
    elif not enabled:
        status = "disabled"
    elif entitlement is not None:
        status = entitlement.status
    elif budget is not None:
        status = "active" if budget.status == "ready" else budget.status
    else:
        status = "not_configured"
    launch_enabled = (
        enabled
        and status in {"active", "ready"}
        and budget is not None
        and budget.status == "ready"
        and budget.litellm_sync_status == "synced"
    )
    ready_models = _managed_credit_ready_models() if launch_enabled else ()
    return AccountFreeLlmCreditsRecord(
        enabled=enabled,
        status=status,
        included_budget_usd=included_budget_usd,
        period_key=period_key,
        launch_enabled=launch_enabled,
        ready_agent_models=ready_models,
        last_error_code=(
            entitlement.last_error_code
            if entitlement is not None and entitlement.last_error_code is not None
            else budget.last_error_code if budget is not None else None
        ),
        last_error_message=(
            entitlement.last_error_message
            if entitlement is not None and entitlement.last_error_message is not None
            else budget.last_error_message if budget is not None else None
        ),
    )


def _current_subscription(subscriptions: list[BillingSubscription]) -> BillingSubscription | None:
    for subscription in subscriptions:
        if subscription.status in {"active", "trialing", "past_due", "unpaid"}:
            return subscription
    return subscriptions[0] if subscriptions else None


async def _team_managed_llm_budget(
    db: AsyncSession,
    organization_id: UUID,
) -> AgentGatewayBudgetSubjectRecord | None:
    from proliferate.db.store.cloud_agent_auth import store as agent_auth_store

    return await agent_auth_store.get_managed_budget_subject(db, organization_id)


def _managed_llm_status(budget: AgentGatewayBudgetSubjectRecord | None) -> str:
    if budget is None:
        return "not_configured"
    if budget.status == "ready":
        return "ready"
    return budget.status


async def _require_current_team_membership(
    db: AsyncSession,
    user: User,
) -> OrganizationWithMembershipRecord:
    membership = await get_current_membership_for_user(db, user.id)
    if membership is None:
        raise BillingServiceError(
            "team_not_found",
            "You do not belong to a team.",
            status_code=404,
        )
    return membership


def _facade_block_reason(reason: str | None) -> str | None:
    if reason == WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED:
        return "compute_credits_exhausted"
    return reason


def _blocked_resource(reason: str | None) -> str | None:
    if reason == WORKSPACE_ACTION_BLOCK_KIND_CREDITS_EXHAUSTED:
        return "compute"
    if reason in {
        WORKSPACE_ACTION_BLOCK_KIND_OVERAGE_DISABLED,
        WORKSPACE_ACTION_BLOCK_KIND_CAP_EXHAUSTED,
    }:
        return "compute"
    if reason == WORKSPACE_ACTION_BLOCK_KIND_CONCURRENCY_LIMIT:
        return "billing"
    return "billing" if reason else None


def _billing_event_summary(kind: str) -> str:
    return {
        "invoice_paid": "Invoice paid",
        "invoice_payment_failed": "Invoice payment failed",
        "invoice_upcoming": "Upcoming invoice",
        "trial_ending": "Trial ending soon",
        "subscription_updated": "Subscription updated",
        "subscription_deleted": "Subscription ended",
        "checkout_activated": "Checkout activated",
        "checkout_failed": "Checkout failed",
        "seat_adjustment_confirmed": "Seat adjustment confirmed",
        "seat_adjustment_failed": "Seat adjustment failed",
        "managed_llm_budget_exhausted": "Managed LLM credits exhausted",
        "managed_llm_budget_synced": "Managed LLM credits synced",
    }.get(kind, "Billing event")


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
    )


def is_free_included_grant(grant_type: str) -> bool:
    if settings.pro_billing_enabled:
        return grant_type == FREE_TRIAL_V2_GRANT_TYPE
    return grant_type == FREE_INCLUDED_GRANT_TYPE


def _map_stripe_error(error: stripe_billing.StripeBillingError) -> BillingServiceError:
    return BillingServiceError(error.code, error.message, status_code=error.status_code)


def _require_redirect_urls() -> tuple[str, str, str]:
    success_url = settings.stripe_checkout_success_url
    cancel_url = settings.stripe_checkout_cancel_url
    portal_return_url = settings.stripe_customer_portal_return_url
    if not (success_url and cancel_url and portal_return_url):
        raise BillingServiceError(
            "stripe_redirect_urls_unconfigured",
            "Stripe redirect URLs are not configured.",
            status_code=503,
        )
    return success_url, cancel_url, portal_return_url


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
    user: User,
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
    user: User,
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


def _team_checkout_intent_response(
    record: CheckoutIntentRecord | CheckoutIntentWithOrganizationRecord,
) -> TeamCheckoutIntentResponse:
    intent = record.intent if hasattr(record, "intent") else record
    return TeamCheckoutIntentResponse(
        id=str(intent.id),
        organization_id=str(intent.organization_id),
        team_name=intent.team_name,
        status=intent.status,
        activation_status=intent.activation_status,
        activation_error_code=intent.activation_error_code,
        activation_error_message=intent.activation_error_message,
        checkout_url=intent.checkout_url,
        expires_at=intent.expires_at.isoformat(),
    )


def _raise_team_name_issue(team_name: str) -> str:
    issue = organization_name_issue(team_name)
    if issue is not None:
        raise BillingServiceError(issue.code, issue.message, status_code=issue.status_code)
    return clean_organization_name(team_name)


def _organization_invite_token_hash(raw_token: str) -> str:
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{ORGANIZATION_INVITE_TOKEN_DOMAIN}:{raw_token}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _organization_invitation_landing_url(token: str) -> str:
    path = "/v1/organizations/invitations/landing"
    query = urlencode({"token": token})
    base_url = (settings.api_base_url or settings.frontend_base_url).rstrip("/")
    if not base_url:
        return f"{path}?{query}"
    return f"{base_url}{path}?{query}"


async def _send_staged_team_checkout_invitation(
    *,
    organization_id: UUID,
    organization_name: str,
    invited_by_user_id: UUID,
    inviter_email: str,
    email: str,
) -> None:
    token = secrets.token_urlsafe(32)
    record = await invitation_store.create_or_rotate_organization_invitation(
        organization_id=organization_id,
        email=email,
        role=ORGANIZATION_ROLE_MEMBER,
        token_hash=_organization_invite_token_hash(token),
        invited_by_user_id=invited_by_user_id,
        expires_at=utcnow() + timedelta(days=ORGANIZATION_INVITE_EXPIRES_DAYS),
    )
    if record is None:
        logger.warning(
            "Skipping staged team checkout invitation because organization was not found",
            extra={"organization_id": str(organization_id), "email": email},
        )
        return
    try:
        result = await resend.send_organization_invitation_email(
            to_email=record.invitation.email,
            organization_name=organization_name,
            inviter_email=inviter_email,
            invite_url=_organization_invitation_landing_url(token),
        )
    except resend.ResendEmailError as error:
        async with db_engine.async_session_factory() as db, db.begin():
            await invitation_store.mark_invitation_delivery(
                db,
                invitation_id=record.invitation.id,
                sent=False,
                skipped=False,
                error=error.message,
            )
        logger.warning(
            "Failed to deliver staged team checkout invitation",
            extra={
                "organization_id": str(organization_id),
                "invitation_id": str(record.invitation.id),
                "email": record.invitation.email,
                "error_code": error.code,
            },
        )
        return
    async with db_engine.async_session_factory() as db, db.begin():
        await invitation_store.mark_invitation_delivery(
            db,
            invitation_id=record.invitation.id,
            sent=not result.skipped,
            skipped=result.skipped,
        )


async def _send_staged_team_checkout_invitations(
    *,
    organization_id: UUID,
    organization_name: str,
    invited_by_user_id: UUID,
    inviter_email: str,
    invite_emails_json: str | None,
) -> None:
    if not invite_emails_json:
        return
    try:
        raw_invites = json.loads(invite_emails_json)
    except ValueError:
        logger.warning(
            "Skipping staged team checkout invitations because invite JSON is invalid",
            extra={"organization_id": str(organization_id)},
        )
        return
    if not isinstance(raw_invites, list):
        return
    invite_emails = sorted(
        {
            email.strip().lower()
            for email in raw_invites
            if isinstance(email, str) and email.strip()
        }
    )
    for email in invite_emails:
        try:
            await _send_staged_team_checkout_invitation(
                organization_id=organization_id,
                organization_name=organization_name,
                invited_by_user_id=invited_by_user_id,
                inviter_email=inviter_email,
                email=email,
            )
        except Exception:
            logger.exception(
                "Unexpected failure while creating staged team checkout invitation",
                extra={"organization_id": str(organization_id), "email": email},
            )


async def _ensure_stripe_customer_for_team_checkout(
    db: AsyncSession,
    *,
    user: User,
    organization_id: UUID,
    billing_subject_id: UUID,
    team_name: str,
) -> str:
    async with db.begin():
        state = await get_or_create_organization_stripe_customer_state(db, organization_id)
    if state.stripe_customer_id:
        return state.stripe_customer_id
    try:
        customer = await stripe_billing.create_customer(
            email=user.email,
            name=team_name,
            billing_subject_id=str(billing_subject_id),
            organization_id=str(organization_id),
            created_by_user_id=str(user.id),
            idempotency_key=f"customer:{billing_subject_id}",
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
        await bind_stripe_customer_to_billing_subject(
            db,
            billing_subject_id=billing_subject_id,
            stripe_customer_id=customer_id,
        )
    return customer_id


async def create_team_checkout_session(
    db: AsyncSession,
    user: User,
    *,
    team_name: str,
    invite_emails: list[str],
) -> TeamCheckoutResponse:
    if not settings.pro_billing_enabled:
        raise BillingServiceError(
            "org_pro_billing_disabled",
            "Team billing is not available yet.",
            status_code=409,
        )
    clean_name = _raise_team_name_issue(team_name)
    normalized_invites = sorted({email.strip().lower() for email in invite_emails if email})
    success_url, cancel_url, _portal_return_url = _require_redirect_urls()
    try:
        await stripe_billing.validate_pro_subscription_price_configuration()
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error

    async with db.begin():
        await acquire_membership_activation_lock(db, user.id)
        current = await get_current_membership_for_user(db, user.id)
        if current is not None:
            raise BillingServiceError(
                "already_in_organization",
                "You already belong to a team.",
                status_code=409,
            )
        existing = await get_current_team_checkout_intent(db, user.id)
        if existing is not None and existing.intent.checkout_url:
            return TeamCheckoutResponse(
                url=existing.intent.checkout_url,
                intent_id=str(existing.intent.id),
            )
        if existing is not None:
            await cancel_team_checkout_intent(
                db,
                intent_id=existing.intent.id,
                created_by_user_id=user.id,
            )
        intent_record = await create_pending_team_checkout_intent(
            db,
            created_by_user_id=user.id,
            team_name=clean_name,
            logo_domain=derive_logo_domain_from_email(user.email),
            idempotency_key=(
                f"team-checkout-intent:{user.id}:"
                f"{_idempotency_shape_suffix(clean_name, len(normalized_invites))}"
            ),
            invite_emails=normalized_invites,
            expires_at=utcnow() + timedelta(hours=24),
        )

    stripe_customer_id = await _ensure_stripe_customer_for_team_checkout(
        db,
        user=user,
        organization_id=intent_record.organization.id,
        billing_subject_id=intent_record.intent.billing_subject_id,
        team_name=clean_name,
    )
    monthly_price_id = configured_pro_monthly_price_id()
    overage_price_id = configured_managed_cloud_overage_price_id()
    checkout_shape = _idempotency_shape_suffix(
        monthly_price_id,
        overage_price_id,
        1,
        success_url,
        cancel_url,
        intent_record.intent.id,
    )
    try:
        checkout = await stripe_billing.create_subscription_checkout_session(
            stripe_customer_id=stripe_customer_id,
            billing_subject_id=str(intent_record.intent.billing_subject_id),
            organization_id=str(intent_record.organization.id),
            created_by_user_id=str(user.id),
            cloud_monthly_price_id=monthly_price_id,
            overage_price_id=overage_price_id,
            seat_quantity=1,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=f"team-checkout:{intent_record.intent.id}:{checkout_shape}",
            purpose="team_subscription",
            checkout_intent_id=str(intent_record.intent.id),
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    if checkout.id is None:
        raise BillingServiceError(
            "stripe_invalid_response",
            "Stripe did not return a checkout session id.",
            status_code=502,
        )
    async with db.begin():
        bound = await bind_team_checkout_session(
            db,
            intent_id=intent_record.intent.id,
            stripe_checkout_session_id=checkout.id,
            stripe_customer_id=stripe_customer_id,
            checkout_url=checkout.url,
        )
    if bound is None:
        raise BillingServiceError(
            "team_checkout_intent_not_found",
            "Team checkout setup could not be completed.",
            status_code=409,
        )
    return TeamCheckoutResponse(url=checkout.url, intent_id=str(intent_record.intent.id))


async def get_current_team_checkout(
    db: AsyncSession,
    user: User,
) -> CurrentTeamCheckoutResponse:
    async with db.begin():
        record = await get_current_team_checkout_intent(db, user.id)
    return CurrentTeamCheckoutResponse(
        intent=_team_checkout_intent_response(record) if record is not None else None,
    )


async def cancel_current_team_checkout(
    db: AsyncSession,
    user: User,
    intent_id: UUID,
) -> CurrentTeamCheckoutResponse:
    async with db.begin():
        record = await cancel_team_checkout_intent(
            db,
            intent_id=intent_id,
            created_by_user_id=user.id,
        )
    return CurrentTeamCheckoutResponse(
        intent=_team_checkout_intent_response(record) if record is not None else None,
    )


async def _upsert_team_subscription_from_stripe(
    db: AsyncSession,
    *,
    subscription: dict,
    billing_subject_id: UUID,
) -> BillingSubscription:
    subscription_id = subscription.get("id")
    customer_id = _stripe_id_from_expandable(subscription.get("customer"))
    status = subscription.get("status")
    if not isinstance(subscription_id, str) or not isinstance(customer_id, str):
        raise BillingServiceError(
            "stripe_invalid_subscription",
            "Stripe subscription is missing an id or customer.",
            status_code=502,
        )
    if not isinstance(status, str):
        raise BillingServiceError(
            "stripe_invalid_subscription",
            "Stripe subscription is missing a status.",
            status_code=502,
        )
    details = _stripe_subscription_item_details(
        subscription,
        monthly_price_ids=monthly_subscription_price_ids(billing_price_ids_from_settings()),
        overage_price_ids=overage_subscription_price_ids(billing_price_ids_from_settings()),
    )
    current_period_start, current_period_end = _stripe_subscription_period(
        subscription,
        monthly_item_id=details.monthly_item_id,
        metered_item_id=details.metered_item_id,
    )
    return await upsert_billing_subscription(
        db,
        billing_subject_id=billing_subject_id,
        stripe_subscription_id=subscription_id,
        stripe_customer_id=customer_id,
        status=status,
        cancel_at_period_end=bool(subscription.get("cancel_at_period_end")),
        canceled_at=coerce_utc(None),
        current_period_start=current_period_start,
        current_period_end=current_period_end,
        cloud_monthly_price_id=details.monthly_price_id,
        overage_price_id=details.overage_price_id,
        monthly_subscription_item_id=details.monthly_item_id,
        metered_subscription_item_id=details.metered_item_id,
        latest_invoice_id=_stripe_id_from_expandable(subscription.get("latest_invoice")),
        latest_invoice_status=None,
        hosted_invoice_url=None,
        seat_quantity=details.seat_quantity,
    )


async def activate_team_checkout_from_stripe_session(
    *,
    session: dict,
    webhook_event_id: str | None = None,
) -> None:
    metadata = _stripe_metadata(session)
    if metadata.get("purpose") != "team_subscription":
        return
    intent_id_value = metadata.get("organization_checkout_intent_id")
    organization_id_value = metadata.get("organization_id")
    created_by_user_id_value = metadata.get("created_by_user_id")
    billing_subject_id_value = metadata.get("billing_subject_id")
    if not (
        intent_id_value
        and organization_id_value
        and created_by_user_id_value
        and billing_subject_id_value
    ):
        raise BillingServiceError(
            "team_checkout_metadata_missing",
            "Team checkout metadata is incomplete.",
            status_code=400,
        )
    try:
        intent_id = UUID(intent_id_value)
        organization_id = UUID(organization_id_value)
        created_by_user_id = UUID(created_by_user_id_value)
        billing_subject_id = UUID(billing_subject_id_value)
    except ValueError as exc:
        raise BillingServiceError(
            "team_checkout_metadata_invalid",
            "Team checkout metadata is invalid.",
            status_code=400,
        ) from exc
    subscription_id = _stripe_id_from_expandable(session.get("subscription"))
    customer_id = _stripe_id_from_expandable(session.get("customer"))
    if subscription_id is None or customer_id is None:
        raise BillingServiceError(
            "team_checkout_subscription_missing",
            "Team checkout session is missing its subscription.",
            status_code=400,
        )
    try:
        subscription = await stripe_billing.retrieve_subscription(subscription_id)
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    subscription_metadata = _stripe_metadata(subscription)
    for key, expected in {
        "purpose": "team_subscription",
        "organization_checkout_intent_id": intent_id_value,
        "organization_id": organization_id_value,
        "created_by_user_id": created_by_user_id_value,
        "billing_subject_id": billing_subject_id_value,
    }.items():
        if subscription_metadata.get(key) != expected:
            async with db_engine.async_session_factory() as db, db.begin():
                row = await load_team_checkout_intent_for_update(db, intent_id)
                if row is not None:
                    intent, organization = row
                    await _mark_team_checkout_failed_with_event(
                        db,
                        intent,
                        organization_id=organization.id,
                        activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BILLING_STATE,
                        error_code="team_checkout_subscription_metadata_mismatch",
                        error_message=(
                            "Team checkout subscription metadata does not match "
                            "the checkout session."
                        ),
                        webhook_event_id=webhook_event_id,
                    )
            return
    subscription_shape_error = _team_subscription_shape_error(
        subscription,
        expected_customer_id=customer_id,
    )
    if subscription_shape_error is not None:
        error_code, error_message = subscription_shape_error
        async with db_engine.async_session_factory() as db, db.begin():
            row = await load_team_checkout_intent_for_update(db, intent_id)
            if row is not None:
                intent, organization = row
                await _mark_team_checkout_failed_with_event(
                    db,
                    intent,
                    organization_id=organization.id,
                    activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BILLING_STATE,
                    error_code=error_code,
                    error_message=error_message,
                    webhook_event_id=webhook_event_id,
                )
        return
    status = subscription.get("status")
    if status not in {"active", "trialing"}:
        async with db_engine.async_session_factory() as db, db.begin():
            row = await load_team_checkout_intent_for_update(db, intent_id)
            if row is not None:
                intent, organization = row
                await _mark_team_checkout_failed_with_event(
                    db,
                    intent,
                    organization_id=organization.id,
                    activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BILLING_STATE,
                    error_code="subscription_not_active",
                    error_message="Team subscription is not active or trialing.",
                    webhook_event_id=webhook_event_id,
                )
        return

    staged_invites: tuple[UUID, str, UUID, str, str | None] | None = None
    async with db_engine.async_session_factory() as db, db.begin():
        row = await load_team_checkout_intent_for_update(db, intent_id)
        if row is None:
            raise BillingServiceError(
                "team_checkout_intent_not_found",
                "Team checkout intent was not found.",
                status_code=404,
            )
        intent, organization = row
        if (
            intent.organization_id != organization_id
            or intent.created_by_user_id != created_by_user_id
            or intent.billing_subject_id != billing_subject_id
            or organization.id != organization_id
        ):
            raise BillingServiceError(
                "team_checkout_intent_mismatch",
                "Team checkout intent does not match Stripe metadata.",
                status_code=409,
            )
        if intent.stripe_customer_id != customer_id:
            await _mark_team_checkout_failed_with_event(
                db,
                intent,
                organization_id=organization.id,
                activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BILLING_STATE,
                error_code="team_checkout_customer_mismatch",
                error_message="Team checkout customer does not match the pending intent.",
                webhook_event_id=webhook_event_id,
            )
            return
        if intent.status != ORGANIZATION_CHECKOUT_INTENT_STATUS_PENDING:
            return
        if organization.status != ORGANIZATION_STATUS_PENDING_CHECKOUT:
            await _mark_team_checkout_failed_with_event(
                db,
                intent,
                organization_id=organization.id,
                activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BUSINESS_STATE,
                error_code="organization_not_pending_checkout",
                error_message="Team checkout organization is not pending checkout.",
                webhook_event_id=webhook_event_id,
            )
            return
        creator = await db.get(User, created_by_user_id)
        if creator is None:
            await _mark_team_checkout_failed_with_event(
                db,
                intent,
                organization_id=organization.id,
                activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BUSINESS_STATE,
                error_code="checkout_creator_not_found",
                error_message="Checkout creator account was not found.",
                webhook_event_id=webhook_event_id,
            )
            return
        await acquire_membership_activation_lock(db, created_by_user_id)
        current = await get_current_membership_for_user(db, created_by_user_id)
        if current is not None:
            await _mark_team_checkout_failed_with_event(
                db,
                intent,
                organization_id=organization.id,
                activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BUSINESS_STATE,
                error_code="creator_already_in_organization",
                error_message="Checkout creator already belongs to a team.",
                webhook_event_id=webhook_event_id,
            )
            return
        await mark_team_checkout_activating(db, intent, stripe_subscription_id=subscription_id)
        await _upsert_team_subscription_from_stripe(
            db,
            subscription=subscription,
            billing_subject_id=billing_subject_id,
        )
        activated = await complete_team_checkout_activation(
            db,
            intent=intent,
            organization=organization,
            stripe_subscription_id=subscription_id,
            stripe_customer_id=customer_id,
            webhook_event_id=webhook_event_id,
        )
        await ensure_organization_for_activation(
            db,
            organization_id=activated.organization.id,
            created_by_user_id=created_by_user_id,
        )
        await record_billing_notification_event(
            db,
            billing_subject_id=billing_subject_id,
            organization_id=activated.organization.id,
            user_id=created_by_user_id,
            kind="checkout_activated",
            severity="info",
            source="stripe" if webhook_event_id else "billing",
            external_ref=webhook_event_id,
            idempotency_key=f"checkout_activated:{intent.id}",
            payload_json={"stripe_subscription_id": subscription_id},
            occurred_at=utcnow(),
        )
        staged_invites = (
            activated.organization.id,
            activated.organization.name,
            created_by_user_id,
            creator.email,
            intent.invite_emails_json,
        )
    if staged_invites is not None:
        (
            activated_organization_id,
            activated_organization_name,
            activated_created_by_user_id,
            activated_creator_email,
            activated_invite_emails_json,
        ) = staged_invites
        await _send_staged_team_checkout_invitations(
            organization_id=activated_organization_id,
            organization_name=activated_organization_name,
            invited_by_user_id=activated_created_by_user_id,
            inviter_email=activated_creator_email,
            invite_emails_json=activated_invite_emails_json,
        )


def _team_subscription_shape_error(
    subscription: dict,
    *,
    expected_customer_id: str,
) -> tuple[str, str] | None:
    subscription_customer_id = _stripe_id_from_expandable(subscription.get("customer"))
    if subscription_customer_id != expected_customer_id:
        return (
            "subscription_customer_mismatch",
            "Team checkout subscription customer does not match the checkout session.",
        )
    details = _stripe_subscription_item_details(
        subscription,
        monthly_price_ids=monthly_subscription_price_ids(billing_price_ids_from_settings()),
        overage_price_ids=overage_subscription_price_ids(billing_price_ids_from_settings()),
    )
    if (
        details.monthly_item_id is None
        or details.monthly_price_id is None
        or classify_monthly_price_id(details.monthly_price_id) != BILLING_PRICE_CLASS_PRO
    ):
        return (
            "subscription_missing_team_price",
            "Team checkout subscription is missing the configured Team seat price.",
        )
    if details.seat_quantity is None or details.seat_quantity < 1:
        return (
            "subscription_invalid_seat_quantity",
            "Team checkout subscription has an invalid seat quantity.",
        )
    if (
        settings.stripe_managed_cloud_overage_price_id
        and details.metered_item_id is None
    ):
        return (
            "subscription_missing_overage_item",
            "Team checkout subscription is missing the configured managed cloud overage item.",
        )
    current_period_start, current_period_end = _stripe_subscription_period(
        subscription,
        monthly_item_id=details.monthly_item_id,
        metered_item_id=details.metered_item_id,
    )
    if (
        current_period_start is None
        or current_period_end is None
        or current_period_end <= current_period_start
    ):
        return (
            "subscription_invalid_period",
            "Team checkout subscription has an invalid billing period.",
        )
    return None


async def create_cloud_checkout_session(
    db: AsyncSession,
    user: User,
    owner_selection: OwnerSelection | None = None,
) -> BillingUrlResponse:
    selection = owner_selection or OwnerSelection()
    org_context: OwnerContext | None = None
    if selection.owner_scope == "personal":
        await _require_personal_paid_checkout_allowed(db, user)
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
                "Team billing is not available yet.",
                status_code=409,
            )
    success_url, cancel_url, portal_return_url = _require_redirect_urls()
    try:
        if settings.pro_billing_enabled:
            await stripe_billing.validate_pro_subscription_price_configuration()
        else:
            await stripe_billing.validate_cloud_subscription_price_configuration()
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error

    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
        user,
        selection,
        owner_context=org_context,
    )
    async with db.begin():
        snapshot = await _get_billing_snapshot_for_subject_request(db, subject_id)
        seat_quantity = (
            await count_active_seats_for_billing_subject_id(db, subject_id)
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
    user: User,
    owner_selection: OwnerSelection | None = None,
) -> BillingUrlResponse:
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "organization":
        raise BillingServiceError(
            "refill_checkout_not_supported_for_org",
            "Legacy cloud credit checkout is not supported for organizations.",
            status_code=409,
        )
    await _require_personal_paid_checkout_allowed(db, user)
    if settings.pro_billing_enabled:
        raise BillingServiceError(
            "refill_checkout_disabled",
            "Legacy cloud credit checkout is unavailable for Team billing.",
            status_code=409,
        )
    success_url, cancel_url, _portal_return_url = _require_redirect_urls()
    try:
        await stripe_billing.validate_refill_price_configuration()
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
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


async def _require_personal_paid_checkout_allowed(db: AsyncSession, user: User) -> None:
    if (
        settings.proliferate_product_mode != "hosted_product"
        or settings.billing_legacy_personal_paid_checkout_enabled
    ):
        return
    async with db.begin():
        state = await get_existing_billing_snapshot_state_for_user(db, user.id)
        legacy_active = False
        if state is not None:
            legacy_active = _build_billing_snapshot(state).legacy_cloud_subscription
    if legacy_active:
        return
    raise BillingServiceError(
        "personal_paid_billing_unavailable",
        "Personal paid Cloud checkout is unavailable. Start a Team plan for paid Cloud usage.",
        status_code=409,
    )


async def create_customer_portal_session(
    db: AsyncSession,
    user: User,
    owner_selection: OwnerSelection | None = None,
) -> BillingUrlResponse:
    _success_url, _cancel_url, portal_return_url = _require_redirect_urls()
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "personal":
        await _require_personal_paid_checkout_allowed(db, user)
    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
        user,
        selection,
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
    user: User,
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


async def _account_usage_for_snapshot_state(
    state: BillingSnapshotState,
    *,
    scan_until: datetime,
    consume_grants: bool,
    subscription: BillingSubscription | None,
) -> BillingAccountingResult:
    return await account_usage_for_billing_subject(
        billing_subject_id=state.billing_subject_id,
        is_paid_cloud=subscription is not None,
        billing_subscription_id=subscription.id if subscription is not None else None,
        period_start=subscription.current_period_start if subscription is not None else None,
        period_end=subscription.current_period_end if subscription is not None else None,
        overage_enabled=state.subject.overage_enabled if subscription is not None else False,
        overage_cap_cents=(
            max(state.active_seat_count, 1)
            * int(
                state.subject.overage_cap_cents_per_seat
                if state.subject.overage_cap_cents_per_seat is not None
                else PRO_DEFAULT_OVERAGE_CAP_CENTS_PER_SEAT
            )
            if subscription is not None and settings.pro_billing_enabled
            else None
        ),
        billing_mode=settings.cloud_billing_mode,
        consume_grants=consume_grants,
        export_overage=subscription is not None and settings.pro_billing_enabled,
        scan_until=scan_until,
    )


async def run_billing_accounting_pass(*, subject_limit: int = 100) -> None:
    if settings.cloud_billing_mode not in {BILLING_MODE_OBSERVE, BILLING_MODE_ENFORCE}:
        return

    await process_pending_seat_adjustments()

    subject_ids = await list_billing_subject_ids_for_usage_accounting(limit=subject_limit)
    for billing_subject_id in subject_ids:
        state = await load_billing_snapshot_state_for_subject(billing_subject_id)
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
                    await _account_usage_for_snapshot_state(
                        state,
                        scan_until=unlimited_state.unlimited_window_start,
                        consume_grants=True,
                        subscription=None,
                    )
                )
            results.append(
                await _account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=False,
                    subscription=None,
                )
            )
        elif pro_subscription is not None:
            results.append(
                await _account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=pro_subscription,
                )
            )
        else:
            results.append(
                await _account_usage_for_snapshot_state(
                    state,
                    scan_until=now,
                    consume_grants=True,
                    subscription=None,
                )
            )

        if any(result.export_count > 0 for result in results):
            snapshot = _build_billing_snapshot(state)
            await record_billing_decision_event(
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
    if not settings.pro_billing_enabled or settings.cloud_billing_mode == BILLING_MODE_OFF:
        return

    adjustments = await claim_pending_seat_adjustments(limit=limit)
    for adjustment in adjustments:
        try:
            await stripe_billing.update_subscription_item_quantity(
                subscription_item_id=adjustment.monthly_subscription_item_id,
                quantity=adjustment.target_quantity,
                idempotency_key=f"seat-quantity:{adjustment.id}:seats:{adjustment.target_quantity}",
            )
            await mark_seat_adjustment_stripe_confirmed(adjustment_id=adjustment.id)
            if (
                adjustment.period_start is not None
                and adjustment.period_end is not None
                and adjustment.effective_at is not None
                and adjustment.membership_id is not None
                and adjustment.grant_quantity > 0
            ):
                period_start_unix = int(adjustment.period_start.timestamp())
                grant_source_ref = seat_proration_grant_source_ref(
                    subscription_id=adjustment.stripe_subscription_id,
                    membership_id=str(adjustment.membership_id),
                    period_start_unix=period_start_unix,
                )
                hours_granted = prorated_seat_grant_hours(
                    added_seats=adjustment.grant_quantity,
                    period_start=adjustment.period_start,
                    period_end=adjustment.period_end,
                    effective_at=adjustment.effective_at,
                )
                await ensure_billing_grant_record(
                    user_id=adjustment.user_id,
                    billing_subject_id=adjustment.billing_subject_id,
                    grant_type=PRO_SEAT_PRORATION_GRANT_TYPE,
                    hours_granted=hours_granted,
                    effective_at=adjustment.effective_at,
                    expires_at=adjustment.period_end,
                    source_ref=grant_source_ref,
                )
            await mark_seat_adjustment_grant_issued(adjustment_id=adjustment.id)
        except stripe_billing.StripeBillingError as error:
            await mark_seat_adjustment_failed(
                adjustment_id=adjustment.id,
                error=error.message,
                terminal=_stripe_error_is_terminal(error),
            )
        except Exception as error:
            await mark_seat_adjustment_failed(
                adjustment_id=adjustment.id,
                error=f"{type(error).__name__}: {error}",
            )


def _stripe_error_is_terminal(error: stripe_billing.StripeBillingError) -> bool:
    return stripe_status_is_terminal(error.status_code)


async def send_pending_usage_exports(*, limit: int = 100) -> None:
    if settings.cloud_billing_mode != BILLING_MODE_ENFORCE:
        return

    exports = await claim_usage_exports_for_sending(limit=limit)
    now = utcnow()
    for export in exports:
        terminal_error = _terminal_export_error(export.accounted_until, now=now)
        if not export.stripe_customer_id:
            terminal_error = "Billing subject has no Stripe customer id."
        if terminal_error is not None:
            await mark_usage_export_failed(
                export_id=export.id,
                terminal=True,
                error=terminal_error,
            )
            await _record_usage_export_decision(
                billing_subject_id=export.billing_subject_id,
                reason=BILLING_USAGE_EXPORT_STATUS_FAILED_TERMINAL,
            )
            logger.error(
                "billing usage export failed permanently",
                extra={"billing_usage_export_id": str(export.id), "reason": terminal_error},
            )
            continue

        legacy_seconds_export = export.meter_quantity_cents is None
        quantity = (
            max(1, math.ceil(export.quantity_seconds))
            if legacy_seconds_export
            else max(1, int(export.meter_quantity_cents or 0))
        )
        identifier = usage_export_identifier(export.id)
        try:
            meter_kwargs = {
                "event_name": (
                    settings.stripe_sandbox_meter_event_name
                    if legacy_seconds_export
                    else configured_managed_cloud_meter_event_name()
                ),
                "stripe_customer_id": export.stripe_customer_id,
                "identifier": identifier,
                "timestamp": int((coerce_utc(export.accounted_until) or now).timestamp()),
                "idempotency_key": export.idempotency_key,
            }
            if legacy_seconds_export:
                meter_kwargs["quantity_seconds"] = quantity
            else:
                meter_kwargs["quantity"] = quantity
            payload = await stripe_billing.create_meter_event(**meter_kwargs)
        except stripe_billing.StripeBillingError as error:
            await mark_usage_export_failed(
                export_id=export.id,
                terminal=False,
                error=error.message,
            )
            await _record_usage_export_decision(
                billing_subject_id=export.billing_subject_id,
                reason="failed_retryable",
            )
            logger.warning(
                "billing usage export failed and will be retried",
                extra={"billing_usage_export_id": str(export.id), "error": error.message},
            )
            continue

        meter_identifier = payload.get("identifier")
        await mark_usage_export_succeeded(
            export_id=export.id,
            stripe_meter_event_identifier=(
                meter_identifier if isinstance(meter_identifier, str) else identifier
            ),
        )
        await _record_usage_export_decision(
            billing_subject_id=export.billing_subject_id,
            reason=BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
        )


def _terminal_export_error(accounted_until: datetime, *, now: datetime) -> str | None:
    return terminal_meter_event_error(accounted_until, now=now)


async def _record_usage_export_decision(*, billing_subject_id: UUID, reason: str) -> None:
    await record_billing_decision_event(
        billing_subject_id=billing_subject_id,
        actor_user_id=None,
        workspace_id=None,
        decision_type=BILLING_DECISION_OVERAGE_EXPORT,
        mode=settings.cloud_billing_mode,
        would_block_start=False,
        would_pause_active=False,
        reason=reason,
        active_sandbox_count=0,
        remaining_seconds=None,
    )
