"""API schemas for managed cloud sandbox profiles."""

from __future__ import annotations

from pydantic import BaseModel, Field

from proliferate.db.store.cloud_sandbox_profiles import SandboxProfileSnapshot
from proliferate.db.store.cloud_sandboxes import SlotSnapshot
from proliferate.db.store.cloud_sync.targets import (
    CloudTargetRuntimeAccessSnapshot,
    CloudTargetSnapshot,
)


def _iso(value: object) -> str | None:
    return value.isoformat() if hasattr(value, "isoformat") else None


class SandboxProfileResponse(BaseModel):
    id: str
    owner_scope: str = Field(serialization_alias="ownerScope")
    owner_user_id: str | None = Field(default=None, serialization_alias="ownerUserId")
    organization_id: str | None = Field(default=None, serialization_alias="organizationId")
    billing_subject_id: str = Field(serialization_alias="billingSubjectId")
    created_by_user_id: str | None = Field(default=None, serialization_alias="createdByUserId")
    desired_agent_auth_revision: int = Field(serialization_alias="desiredAgentAuthRevision")
    status: str
    primary_target_id: str | None = Field(default=None, serialization_alias="primaryTargetId")
    created_at: str = Field(serialization_alias="createdAt")
    updated_at: str = Field(serialization_alias="updatedAt")


class SandboxTargetSummary(BaseModel):
    id: str
    kind: str
    status: str
    profile_target_role: str = Field(serialization_alias="profileTargetRole")


class SandboxSlotSummary(BaseModel):
    id: str
    status: str
    slot_generation: int | None = Field(default=None, serialization_alias="slotGeneration")
    provider: str
    external_sandbox_id: str | None = Field(default=None, serialization_alias="externalSandboxId")
    blocked_reason: str | None = Field(default=None, serialization_alias="blockedReason")


class SandboxRuntimeAccessSummary(BaseModel):
    target_id: str = Field(serialization_alias="targetId")
    active_sandbox_id: str | None = Field(default=None, serialization_alias="activeSandboxId")
    slot_generation: int | None = Field(default=None, serialization_alias="slotGeneration")
    anyharness_base_url: str | None = Field(default=None, serialization_alias="anyharnessBaseUrl")
    last_worker_id: str | None = Field(default=None, serialization_alias="lastWorkerId")
    last_heartbeat_at: str | None = Field(default=None, serialization_alias="lastHeartbeatAt")


class SandboxProfileTargetStateResponse(BaseModel):
    profile: SandboxProfileResponse
    target: SandboxTargetSummary | None = None
    slot: SandboxSlotSummary | None = None
    runtime_access: SandboxRuntimeAccessSummary | None = Field(
        default=None,
        serialization_alias="runtimeAccess",
    )
    ready: bool


def sandbox_profile_payload(snapshot: SandboxProfileSnapshot) -> SandboxProfileResponse:
    return SandboxProfileResponse(
        id=str(snapshot.id),
        owner_scope=snapshot.owner_scope,
        owner_user_id=str(snapshot.owner_user_id) if snapshot.owner_user_id else None,
        organization_id=str(snapshot.organization_id) if snapshot.organization_id else None,
        billing_subject_id=str(snapshot.billing_subject_id),
        created_by_user_id=(
            str(snapshot.created_by_user_id) if snapshot.created_by_user_id else None
        ),
        desired_agent_auth_revision=snapshot.desired_agent_auth_revision,
        status=snapshot.status,
        primary_target_id=str(snapshot.primary_target_id) if snapshot.primary_target_id else None,
        created_at=_iso(snapshot.created_at) or "",
        updated_at=_iso(snapshot.updated_at) or "",
    )


def target_payload(snapshot: CloudTargetSnapshot | None) -> SandboxTargetSummary | None:
    if snapshot is None:
        return None
    return SandboxTargetSummary(
        id=str(snapshot.id),
        kind=snapshot.kind,
        status=snapshot.status,
        profile_target_role=snapshot.profile_target_role,
    )


def slot_payload(snapshot: SlotSnapshot | None) -> SandboxSlotSummary | None:
    if snapshot is None:
        return None
    return SandboxSlotSummary(
        id=str(snapshot.id),
        status=snapshot.status,
        slot_generation=snapshot.slot_generation,
        provider=snapshot.provider,
        external_sandbox_id=snapshot.external_sandbox_id,
        blocked_reason=snapshot.blocked_reason,
    )


def runtime_access_payload(
    snapshot: CloudTargetRuntimeAccessSnapshot | None,
) -> SandboxRuntimeAccessSummary | None:
    if snapshot is None:
        return None
    return SandboxRuntimeAccessSummary(
        target_id=str(snapshot.target_id),
        active_sandbox_id=(
            str(snapshot.active_sandbox_id) if snapshot.active_sandbox_id else None
        ),
        slot_generation=snapshot.slot_generation,
        anyharness_base_url=snapshot.anyharness_base_url,
        last_worker_id=str(snapshot.last_worker_id) if snapshot.last_worker_id else None,
        last_heartbeat_at=_iso(snapshot.last_heartbeat_at),
    )
