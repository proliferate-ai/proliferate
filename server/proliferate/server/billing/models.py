"""Billing request/response schemas and internal typed values."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


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
