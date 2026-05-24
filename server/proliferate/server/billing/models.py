"""Billing request/response schemas and internal typed values."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


@dataclass(frozen=True)
class BillingSnapshot:
    billing_subject_id: UUID
    plan: str
    billing_mode: str
    is_unlimited: bool
    has_unlimited_cloud_hours: bool
    over_quota: bool
    is_paid_cloud: bool
    payment_healthy: bool
    overage_enabled: bool
    overage_cap_cents_per_seat: int | None
    included_hours: float | None
    used_hours: float
    remaining_hours: float | None
    cloud_repo_limit: int | None
    active_cloud_repo_count: int
    concurrent_sandbox_limit: int | None
    active_sandbox_count: int
    start_blocked: bool
    start_block_reason: str | None
    active_spend_hold: bool
    hold_reason: str | None
    remaining_seconds: float | None
    hosted_invoice_url: str | None
    pro_billing_enabled: bool = False
    billable_seat_count: int | None = None
    included_managed_cloud_hours: float | None = None
    remaining_managed_cloud_hours: float | None = None
    managed_cloud_overage_enabled: bool = False
    managed_cloud_overage_cap_cents: int | None = None
    managed_cloud_overage_used_cents: int = 0
    overage_price_per_hour_cents: int = 200
    active_environment_limit: int | None = None
    repo_environment_limit: int | None = None
    byo_runtime_allowed: bool = False
    legacy_cloud_subscription: bool = False


@dataclass(frozen=True)
class SandboxStartAuthorization:
    allowed: bool
    billing_subject_id: UUID
    start_blocked: bool
    start_block_reason: str | None
    active_spend_hold: bool
    hold_reason: str | None
    message: str | None
    active_sandbox_count: int
    remaining_seconds: float | None
    active_environment_limit: int | None = None


@dataclass(frozen=True)
class GrantAllocation:
    grant_type: str
    total_seconds: float
    consumed_seconds: float
    remaining_seconds: float
    active: bool


class BillingServiceError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


def utcnow() -> datetime:
    return datetime.now(UTC)


def coerce_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def duration_seconds(*, started_at: datetime, ended_at: datetime | None, now: datetime) -> float:
    end = coerce_utc(ended_at) or now
    start = coerce_utc(started_at) or now
    return max((end - start).total_seconds(), 0.0)


class BillingBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class PlanInfo(BillingBaseModel):
    plan: str
    usage_minutes: int = Field(alias="usageMinutes")
    pro_billing_enabled: bool = Field(alias="proBillingEnabled")


class CloudPlanInfo(BillingBaseModel):
    plan: str = Field(description="Public billing plan. Values are `free` or `pro`.")
    billing_mode: str = Field(alias="billingMode")
    pro_billing_enabled: bool = Field(alias="proBillingEnabled")
    is_unlimited: bool = Field(alias="isUnlimited")
    has_unlimited_cloud_hours: bool = Field(alias="hasUnlimitedCloudHours")
    over_quota: bool = Field(alias="overQuota")
    free_sandbox_hours: float | None = Field(alias="freeSandboxHours")
    used_sandbox_hours: float = Field(alias="usedSandboxHours")
    remaining_sandbox_hours: float | None = Field(alias="remainingSandboxHours")
    cloud_repo_limit: int | None = Field(alias="cloudRepoLimit")
    active_cloud_repo_count: int = Field(alias="activeCloudRepoCount")
    concurrent_sandbox_limit: int | None = Field(alias="concurrentSandboxLimit")
    active_sandbox_count: int = Field(alias="activeSandboxCount")
    is_paid_cloud: bool = Field(alias="isPaidCloud")
    payment_healthy: bool = Field(alias="paymentHealthy")
    overage_enabled: bool = Field(alias="overageEnabled")
    hosted_invoice_url: str | None = Field(default=None, alias="hostedInvoiceUrl")
    start_blocked: bool = Field(alias="startBlocked")
    start_block_reason: str | None = Field(default=None, alias="startBlockReason")
    active_spend_hold: bool = Field(alias="activeSpendHold")
    hold_reason: str | None = Field(default=None, alias="holdReason")
    billable_seat_count: int | None = Field(default=None, alias="billableSeatCount")
    included_managed_cloud_hours: float | None = Field(
        default=None,
        alias="includedManagedCloudHours",
    )
    remaining_managed_cloud_hours: float | None = Field(
        default=None,
        alias="remainingManagedCloudHours",
    )
    managed_cloud_overage_enabled: bool = Field(alias="managedCloudOverageEnabled")
    managed_cloud_overage_cap_cents: int | None = Field(
        default=None,
        alias="managedCloudOverageCapCents",
    )
    managed_cloud_overage_used_cents: int = Field(alias="managedCloudOverageUsedCents")
    overage_price_per_hour_cents: int = Field(alias="overagePricePerHourCents")
    active_environment_limit: int | None = Field(default=None, alias="activeEnvironmentLimit")
    repo_environment_limit: int | None = Field(default=None, alias="repoEnvironmentLimit")
    byo_runtime_allowed: bool = Field(alias="byoRuntimeAllowed")
    legacy_cloud_subscription: bool = Field(alias="legacyCloudSubscription")


class BillingOverview(BillingBaseModel):
    plan: str = Field(description="Public billing plan. Values are `free` or `pro`.")
    billing_mode: str = Field(alias="billingMode")
    pro_billing_enabled: bool = Field(alias="proBillingEnabled")
    is_unlimited: bool = Field(alias="isUnlimited")
    has_unlimited_cloud_hours: bool = Field(alias="hasUnlimitedCloudHours")
    over_quota: bool = Field(alias="overQuota")
    included_hours: float | None = Field(alias="includedHours")
    used_hours: float = Field(alias="usedHours")
    remaining_hours: float | None = Field(alias="remainingHours")
    cloud_repo_limit: int | None = Field(alias="cloudRepoLimit")
    active_cloud_repo_count: int = Field(alias="activeCloudRepoCount")
    concurrent_sandbox_limit: int | None = Field(alias="concurrentSandboxLimit")
    active_sandbox_count: int = Field(alias="activeSandboxCount")
    is_paid_cloud: bool = Field(alias="isPaidCloud")
    payment_healthy: bool = Field(alias="paymentHealthy")
    overage_enabled: bool = Field(alias="overageEnabled")
    hosted_invoice_url: str | None = Field(default=None, alias="hostedInvoiceUrl")
    start_blocked: bool = Field(alias="startBlocked")
    start_block_reason: str | None = Field(default=None, alias="startBlockReason")
    active_spend_hold: bool = Field(alias="activeSpendHold")
    hold_reason: str | None = Field(default=None, alias="holdReason")
    billable_seat_count: int | None = Field(default=None, alias="billableSeatCount")
    included_managed_cloud_hours: float | None = Field(
        default=None,
        alias="includedManagedCloudHours",
    )
    remaining_managed_cloud_hours: float | None = Field(
        default=None,
        alias="remainingManagedCloudHours",
    )
    managed_cloud_overage_enabled: bool = Field(alias="managedCloudOverageEnabled")
    managed_cloud_overage_cap_cents: int | None = Field(
        default=None,
        alias="managedCloudOverageCapCents",
    )
    managed_cloud_overage_used_cents: int = Field(alias="managedCloudOverageUsedCents")
    overage_price_per_hour_cents: int = Field(alias="overagePricePerHourCents")
    active_environment_limit: int | None = Field(default=None, alias="activeEnvironmentLimit")
    repo_environment_limit: int | None = Field(default=None, alias="repoEnvironmentLimit")
    byo_runtime_allowed: bool = Field(alias="byoRuntimeAllowed")
    legacy_cloud_subscription: bool = Field(alias="legacyCloudSubscription")


class StripeWebhookAck(BillingBaseModel):
    ok: bool = True
    event_id: str = Field(alias="eventId")
    event_type: str = Field(alias="eventType")
    livemode: bool | None = None


class BillingUrlResponse(BillingBaseModel):
    url: str


class TeamCheckoutRequest(BillingBaseModel):
    team_name: str = Field(alias="teamName", min_length=1, max_length=255)
    invite_emails: list[EmailStr] = Field(default_factory=list, alias="inviteEmails")


class TeamCheckoutResponse(BillingBaseModel):
    url: str
    intent_id: str = Field(alias="intentId")


class TeamCheckoutIntentResponse(BillingBaseModel):
    id: str
    organization_id: str = Field(alias="organizationId")
    team_name: str = Field(alias="teamName")
    status: str
    activation_status: str = Field(alias="activationStatus")
    activation_error_code: str | None = Field(default=None, alias="activationErrorCode")
    activation_error_message: str | None = Field(default=None, alias="activationErrorMessage")
    checkout_url: str | None = Field(default=None, alias="checkoutUrl")
    expires_at: str = Field(alias="expiresAt")


class CurrentTeamCheckoutResponse(BillingBaseModel):
    intent: TeamCheckoutIntentResponse | None = None


class BillingOwnerSelection(BillingBaseModel):
    owner_scope: Literal["personal", "organization"] = Field(
        default="personal",
        alias="ownerScope",
    )
    organization_id: UUID | None = Field(default=None, alias="organizationId")


class OverageSettingsRequest(BillingBaseModel):
    enabled: bool
    cap_cents_per_seat: int | None = Field(default=None, alias="capCentsPerSeat")
    owner_scope: Literal["personal", "organization"] = Field(
        default="personal",
        alias="ownerScope",
    )
    organization_id: UUID | None = Field(default=None, alias="organizationId")


class OverageSettingsResponse(BillingBaseModel):
    overage_enabled: bool = Field(alias="overageEnabled")
    overage_cap_cents_per_seat: int | None = Field(
        default=None,
        alias="overageCapCentsPerSeat",
    )


class AccountCreditsEnsureOutcome(StrEnum):
    CREATED = "created"
    EXISTING_SAME_SUBJECT = "existing_same_subject"
    MISSING_GITHUB_IDENTITY = "missing_github_identity"
    GITHUB_IDENTITY_ALREADY_ALLOCATED = "github_identity_already_allocated"
    DISABLED_BY_DEPLOYMENT = "disabled_by_deployment"
    NOT_APPLICABLE = "not_applicable"


class AccountFreeCloudCredits(BillingBaseModel):
    included_hours: float = Field(alias="includedHours")
    used_hours: float = Field(alias="usedHours")
    remaining_hours: float = Field(alias="remainingHours")
    status: str


class AccountFreeLlmReadyAgentModel(BillingBaseModel):
    agent_kind: str = Field(alias="agentKind")
    model_id: str = Field(alias="modelId")


class AccountFreeLlmCredits(BillingBaseModel):
    enabled: bool
    status: str
    included_budget_usd: str = Field(alias="includedBudgetUsd")
    period_key: str = Field(alias="periodKey")
    launch_enabled: bool = Field(alias="launchEnabled")
    ready_agent_models: list[AccountFreeLlmReadyAgentModel] = Field(alias="readyAgentModels")
    last_error_code: str | None = Field(default=None, alias="lastErrorCode")
    last_error_message: str | None = Field(default=None, alias="lastErrorMessage")


class AccountCreditsOverview(BillingBaseModel):
    billing_subject_id: UUID | None = Field(alias="billingSubjectId")
    free_cloud: AccountFreeCloudCredits = Field(alias="freeCloud")
    free_llm: AccountFreeLlmCredits = Field(alias="freeLlm")
    github_required: bool = Field(alias="githubRequired")
    free_allocation_status: str = Field(alias="freeAllocationStatus")
    start_blocked: bool = Field(alias="startBlocked")
    start_block_reason: str | None = Field(default=None, alias="startBlockReason")
    blocked_resource: str | None = Field(default=None, alias="blockedResource")


class AccountCreditsEnsureResponse(BillingBaseModel):
    account_credits: AccountCreditsOverview = Field(alias="accountCredits")
    free_allocation_outcome: str = Field(alias="freeAllocationOutcome")
    free_allocation_blocked_reason: str | None = Field(
        default=None,
        alias="freeAllocationBlockedReason",
    )


class TeamOverageSettingsRequest(BillingBaseModel):
    enabled: bool
    cap_cents_per_seat: int | None = Field(default=None, alias="capCentsPerSeat")


class TeamManagedCloudBilling(BillingBaseModel):
    included_hours: float | None = Field(default=None, alias="includedHours")
    used_hours: float = Field(alias="usedHours")
    remaining_hours: float | None = Field(default=None, alias="remainingHours")
    overage_enabled: bool = Field(alias="overageEnabled")
    overage_cap_cents: int | None = Field(default=None, alias="overageCapCents")
    overage_used_cents: int = Field(alias="overageUsedCents")


class TeamManagedLlmBilling(BillingBaseModel):
    included_budget_usd: str | None = Field(default=None, alias="includedBudgetUsd")
    status: str
    period_key: str | None = Field(default=None, alias="periodKey")
    litellm_sync_status: str | None = Field(default=None, alias="litellmSyncStatus")
    last_error_code: str | None = Field(default=None, alias="lastErrorCode")


class TeamBillingOverview(BillingBaseModel):
    organization_id: UUID = Field(alias="organizationId")
    name: str
    role: str
    can_manage_billing: bool = Field(alias="canManageBilling")
    plan: str
    subscription_status: str | None = Field(default=None, alias="subscriptionStatus")
    payment_healthy: bool = Field(alias="paymentHealthy")
    seat_quantity: int | None = Field(default=None, alias="seatQuantity")
    active_member_count: int = Field(alias="activeMemberCount")
    current_period_start: str | None = Field(default=None, alias="currentPeriodStart")
    current_period_end: str | None = Field(default=None, alias="currentPeriodEnd")
    hosted_invoice_url: str | None = Field(default=None, alias="hostedInvoiceUrl")
    managed_cloud: TeamManagedCloudBilling = Field(alias="managedCloud")
    managed_llm: TeamManagedLlmBilling = Field(alias="managedLlm")
    start_blocked: bool = Field(alias="startBlocked")
    start_block_reason: str | None = Field(default=None, alias="startBlockReason")
    blocked_resource: str | None = Field(default=None, alias="blockedResource")


class TeamBillingEnvelope(BillingBaseModel):
    team: TeamBillingOverview | None
    can_create_team: bool = Field(alias="canCreateTeam")
    pending_checkout: TeamCheckoutIntentResponse | None = Field(
        default=None,
        alias="pendingCheckout",
    )


class BillingEventSummary(BillingBaseModel):
    id: UUID
    kind: str
    severity: str
    occurred_at: str = Field(alias="occurredAt")
    recorded_at: str = Field(alias="recordedAt")
    summary: str
    stripe_object_id: str | None = Field(default=None, alias="stripeObjectId")


class BillingEventsResponse(BillingBaseModel):
    events: list[BillingEventSummary]


def _wire_datetime(value: datetime | None) -> str | None:
    coerced = coerce_utc(value)
    if coerced is None:
        return None
    return coerced.isoformat().replace("+00:00", "Z")


def _round_hours(value: float | None, digits: int = 4) -> float | None:
    return round(value, digits) if value is not None else None


def account_credits_overview_response(record: object) -> AccountCreditsOverview:
    return AccountCreditsOverview(
        billingSubjectId=record.billing_subject_id,
        freeCloud=AccountFreeCloudCredits(
            includedHours=round(record.free_cloud.included_hours, 2),
            usedHours=round(record.free_cloud.used_hours, 4),
            remainingHours=round(record.free_cloud.remaining_hours, 4),
            status=record.free_cloud.status,
        ),
        freeLlm=AccountFreeLlmCredits(
            enabled=record.free_llm.enabled,
            status=record.free_llm.status,
            includedBudgetUsd=record.free_llm.included_budget_usd,
            periodKey=record.free_llm.period_key,
            launchEnabled=record.free_llm.launch_enabled,
            readyAgentModels=[
                AccountFreeLlmReadyAgentModel(
                    agentKind=model.agent_kind,
                    modelId=model.model_id,
                )
                for model in record.free_llm.ready_agent_models
            ],
            lastErrorCode=record.free_llm.last_error_code,
            lastErrorMessage=record.free_llm.last_error_message,
        ),
        githubRequired=record.github_required,
        freeAllocationStatus=record.free_allocation_status,
        startBlocked=record.start_blocked,
        startBlockReason=record.start_block_reason,
        blockedResource=record.blocked_resource,
    )


def account_credits_ensure_response(record: object) -> AccountCreditsEnsureResponse:
    return AccountCreditsEnsureResponse(
        accountCredits=account_credits_overview_response(record.account_credits),
        freeAllocationOutcome=record.free_allocation_outcome.value,
        freeAllocationBlockedReason=record.free_allocation_blocked_reason,
    )


def team_billing_envelope_response(record: object) -> TeamBillingEnvelope:
    team = record.team
    return TeamBillingEnvelope(
        team=None if team is None else _team_billing_overview_response(team),
        canCreateTeam=record.can_create_team,
        pendingCheckout=record.pending_checkout,
    )


def _team_billing_overview_response(record: object) -> TeamBillingOverview:
    return TeamBillingOverview(
        organizationId=record.organization_id,
        name=record.name,
        role=record.role,
        canManageBilling=record.can_manage_billing,
        plan=record.plan,
        subscriptionStatus=record.subscription_status,
        paymentHealthy=record.payment_healthy,
        seatQuantity=record.seat_quantity,
        activeMemberCount=record.active_member_count,
        currentPeriodStart=_wire_datetime(record.current_period_start),
        currentPeriodEnd=_wire_datetime(record.current_period_end),
        hostedInvoiceUrl=record.hosted_invoice_url,
        managedCloud=TeamManagedCloudBilling(
            includedHours=_round_hours(record.managed_cloud.included_hours, 2),
            usedHours=round(record.managed_cloud.used_hours, 4),
            remainingHours=_round_hours(record.managed_cloud.remaining_hours, 4),
            overageEnabled=record.managed_cloud.overage_enabled,
            overageCapCents=record.managed_cloud.overage_cap_cents,
            overageUsedCents=record.managed_cloud.overage_used_cents,
        ),
        managedLlm=TeamManagedLlmBilling(
            includedBudgetUsd=record.managed_llm.included_budget_usd,
            status=record.managed_llm.status,
            periodKey=record.managed_llm.period_key,
            litellmSyncStatus=record.managed_llm.litellm_sync_status,
            lastErrorCode=record.managed_llm.last_error_code,
        ),
        startBlocked=record.start_blocked,
        startBlockReason=record.start_block_reason,
        blockedResource=record.blocked_resource,
    )


def billing_events_response(records: Iterable[object]) -> BillingEventsResponse:
    return BillingEventsResponse(
        events=[
            BillingEventSummary(
                id=record.id,
                kind=record.kind,
                severity=record.severity,
                occurredAt=_wire_datetime(record.occurred_at) or "",
                recordedAt=_wire_datetime(record.recorded_at) or "",
                summary=record.summary,
                stripeObjectId=record.stripe_object_id,
            )
            for record in records
        ]
    )
