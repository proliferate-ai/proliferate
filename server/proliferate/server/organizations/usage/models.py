"""Pydantic schemas for organization usage visibility + budget-limit admin."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from proliferate.server.billing.models import UsageTimeseriesBucket

BudgetLimitKind = Literal["compute", "llm"]
BudgetLimitWindow = Literal["day", "month"]


class OrganizationUsageBaseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class OrgUserUsageRow(OrganizationUsageBaseModel):
    user_id: UUID = Field(alias="userId")
    display_name: str | None = Field(alias="displayName")
    email: str
    compute_seconds: float = Field(alias="computeSeconds")
    llm_cost_usd: float = Field(alias="llmCostUsd")
    compute_limit_cap_seconds: float | None = Field(alias="computeLimitCapSeconds")
    llm_limit_cap_usd: float | None = Field(alias="llmLimitCapUsd")


class OrgUsageByUserResponse(OrganizationUsageBaseModel):
    users: list[OrgUserUsageRow]


class OrgUserUsageTimeseriesResponse(OrganizationUsageBaseModel):
    buckets: list[UsageTimeseriesBucket]


class BudgetLimit(OrganizationUsageBaseModel):
    id: UUID
    user_id: UUID | None = Field(alias="userId")
    kind: BudgetLimitKind
    window: BudgetLimitWindow
    cap_value: float = Field(alias="capValue")
    enabled: bool
    updated_at: datetime = Field(alias="updatedAt")


class BudgetLimitsResponse(OrganizationUsageBaseModel):
    limits: list[BudgetLimit]


class BudgetLimitInput(OrganizationUsageBaseModel):
    user_id: UUID | None = Field(default=None, alias="userId")
    kind: BudgetLimitKind
    window: BudgetLimitWindow
    cap_value: float = Field(alias="capValue")
    enabled: bool = True


class PutBudgetLimitsRequest(OrganizationUsageBaseModel):
    limits: list[BudgetLimitInput]
