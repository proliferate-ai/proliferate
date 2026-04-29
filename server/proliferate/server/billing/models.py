"""Billing request/response schemas and internal typed values."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


@dataclass(frozen=True)
class BillingSnapshot:
    billing_subject_id: UUID
    plan: str
    billing_mode: str
    is_unlimited: bool
    over_quota: bool
    included_hours: float | None
    used_hours: float
    remaining_hours: float | None
    concurrent_sandbox_limit: int
    active_sandbox_count: int
    start_blocked: bool
    start_block_reason: str | None
    active_spend_hold: bool
    hold_reason: str | None
    remaining_seconds: float | None
    blocked: bool
    blocked_reason: str | None


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
    plan: str
    billing_mode: str = Field(alias="billingMode")
    is_unlimited: bool = Field(alias="isUnlimited")
    over_quota: bool = Field(alias="overQuota")
    free_sandbox_hours: float | None = Field(alias="freeSandboxHours")
    used_sandbox_hours: float = Field(alias="usedSandboxHours")
    remaining_sandbox_hours: float | None = Field(alias="remainingSandboxHours")
    concurrent_sandbox_limit: int = Field(alias="concurrentSandboxLimit")
    active_sandbox_count: int = Field(alias="activeSandboxCount")
    start_blocked: bool = Field(alias="startBlocked")
    start_block_reason: str | None = Field(default=None, alias="startBlockReason")
    active_spend_hold: bool = Field(alias="activeSpendHold")
    hold_reason: str | None = Field(default=None, alias="holdReason")
    blocked: bool
    blocked_reason: str | None = Field(default=None, alias="blockedReason")


class BillingOverview(BillingBaseModel):
    plan: str
    billing_mode: str = Field(alias="billingMode")
    is_unlimited: bool = Field(alias="isUnlimited")
    over_quota: bool = Field(alias="overQuota")
    included_hours: float | None = Field(alias="includedHours")
    used_hours: float = Field(alias="usedHours")
    remaining_hours: float | None = Field(alias="remainingHours")
    concurrent_sandbox_limit: int = Field(alias="concurrentSandboxLimit")
    active_sandbox_count: int = Field(alias="activeSandboxCount")
    start_blocked: bool = Field(alias="startBlocked")
    start_block_reason: str | None = Field(default=None, alias="startBlockReason")
    active_spend_hold: bool = Field(alias="activeSpendHold")
    hold_reason: str | None = Field(default=None, alias="holdReason")
    blocked: bool
    blocked_reason: str | None = Field(default=None, alias="blockedReason")
