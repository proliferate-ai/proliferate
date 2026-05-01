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


class CloudPlanInfo(BillingBaseModel):
    plan: str = Field(
        description=(
            "`cloud` is a paid Cloud subscription, `unlimited` is a manual unlimited "
            "entitlement, and both grant unlimited Cloud hours."
        )
    )
    billing_mode: str = Field(alias="billingMode")
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


class BillingOverview(BillingBaseModel):
    plan: str = Field(
        description=(
            "`cloud` is a paid Cloud subscription, `unlimited` is a manual unlimited "
            "entitlement, and both grant unlimited Cloud hours."
        )
    )
    billing_mode: str = Field(alias="billingMode")
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
    owner_scope: Literal["personal", "organization"] = Field(
        default="personal",
        alias="ownerScope",
    )
    organization_id: UUID | None = Field(default=None, alias="organizationId")


class OverageSettingsResponse(BillingBaseModel):
    overage_enabled: bool = Field(alias="overageEnabled")
