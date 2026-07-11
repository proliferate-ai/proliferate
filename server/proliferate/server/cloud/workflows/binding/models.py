"""HTTP models for the binding-acceptance bridge."""

from __future__ import annotations

from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from proliferate.server.cloud.workflows.contracts.models import (
    ExecutionBinding,
    MaterializationOffer,
)


class BindingApiModel(BaseModel):
    model_config = ConfigDict(
        populate_by_name=False,
        validate_by_alias=True,
        validate_by_name=False,
        extra="forbid",
        strict=True,
    )


class BindingResponseModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid", strict=True)


class CreateMaterializationOfferRequest(BindingApiModel):
    executor_id: str = Field(alias="executorId", min_length=1, max_length=255)
    # UUID is intentionally a string at the JSON boundary.  BindingApiModel is
    # strict, so a UUID-typed field would reject every valid JSON UUID string.
    claim_id: str | None = Field(default=None, alias="claimId")

    @field_validator("claim_id")
    @classmethod
    def _validate_claim_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        try:
            parsed = UUID(value)
        except ValueError as exc:
            raise ValueError("claimId must be a canonical lowercase UUID") from exc
        if str(parsed) != value:
            raise ValueError("claimId must be a canonical lowercase UUID")
        return value


class AcceptExecutionBindingRequest(BindingApiModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    execution_generation: int = Field(alias="executionGeneration", gt=0)
    executor_fence: str = Field(alias="executorFence", min_length=1, max_length=255)
    # Kept raw until the service recomputes bindingHash from these exact members.
    binding: dict[str, Any]


class ExecutionBindingAcceptanceResponse(BindingResponseModel):
    accepted: bool
    idempotent: bool
    run_id: str = Field(alias="runId")
    plan_hash: str = Field(alias="planHash")
    binding_hash: str = Field(alias="bindingHash")
    execution_generation: int = Field(alias="executionGeneration")
    acceptance_state: Literal["accepted"] = Field(alias="acceptanceState")
    binding: ExecutionBinding


class ExecutionBindingStatusResponse(BindingResponseModel):
    accepted: Literal[True]
    run_id: str = Field(alias="runId")
    plan_hash: str = Field(alias="planHash")
    binding_hash: str = Field(alias="bindingHash")
    execution_generation: int = Field(alias="executionGeneration")
    acceptance_state: Literal["accepted"] = Field(alias="acceptanceState")
    binding: ExecutionBinding


__all__ = [
    "AcceptExecutionBindingRequest",
    "CreateMaterializationOfferRequest",
    "ExecutionBindingAcceptanceResponse",
    "ExecutionBindingStatusResponse",
    "MaterializationOffer",
]
