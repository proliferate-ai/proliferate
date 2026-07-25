"""Shared custody vocabulary for the workflow invocation/delivery stores.

This module owns the row shapes and exact-custody matching primitives used by
`workflow_invocations`, `workflow_deliveries`, and `workflow_delivery_loss`:
delivery status constants, the typed expected-target identities, immutable
row snapshots, and the SQL conditions that correlate a delivery CAS with the
immutable invocation row (PR2 design §6.1/§7.2/§8.3).

Digest-covered documents (arguments, resolved bundle, placements, runtime
payload) are stored as RFC 8785 canonical JSON text. JSONB would normalize
numeric forms — `1e21` reloads as the integer `1000000000000000000000` — and
silently break digest recomputation and replay. Snapshots parse those columns
with the canonical replay loader so callers never touch the raw text.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import cast
from uuid import UUID

from sqlalchemy import ColumnElement, Exists, func, select

from proliferate.db.models.workflows import WorkflowInvocation, WorkflowInvocationDelivery
from proliferate.utils.canonical_json import parse_canonical_json

DELIVERY_STATUS_QUEUED = "queued"
DELIVERY_STATUS_DELIVERING = "delivering"
DELIVERY_STATUS_ACCEPTED = "accepted"
DELIVERY_STATUS_FAILED = "failed"
DELIVERY_STATUS_CANCELLED = "cancelled"

# AnyHarness run statuses that are terminal execution outcomes (design §18).
# A projection already showing one of these blocks any later loss proof.
TERMINAL_OBSERVATION_STATUSES = ("succeeded", "failed", "cancelled")


@dataclass(frozen=True)
class ManagedCloudTarget:
    """Expected identity of a managed Cloud delivery target (design §6.1)."""

    cloud_sandbox_id: str

    def __post_init__(self) -> None:
        if not self.cloud_sandbox_id:
            raise ValueError("A managed Cloud target requires its exact sandbox ID.")


@dataclass(frozen=True)
class DesktopTarget:
    """Expected identity of a desktop delivery target (design §6.1)."""

    desktop_install_id: str

    def __post_init__(self) -> None:
        if not self.desktop_install_id:
            raise ValueError("A desktop target requires its exact install ID.")


ExpectedDeliveryTarget = ManagedCloudTarget | DesktopTarget


def invocation_target_exists(
    invocation_id: UUID, expected_target: ExpectedDeliveryTarget
) -> Exists:
    """Correlate a delivery CAS with the immutable invocation target row."""

    if isinstance(expected_target, ManagedCloudTarget):
        return (
            select(WorkflowInvocation.id)
            .where(
                WorkflowInvocation.id == invocation_id,
                WorkflowInvocation.target_kind == "managedCloud",
                WorkflowInvocation.desktop_install_id.is_(None),
            )
            .exists()
        )
    return (
        select(WorkflowInvocation.id)
        .where(
            WorkflowInvocation.id == invocation_id,
            WorkflowInvocation.target_kind == "desktop",
            WorkflowInvocation.desktop_install_id == expected_target.desktop_install_id,
        )
        .exists()
    )


def exact_target_conditions(
    invocation_id: UUID, expected_target: ExpectedDeliveryTarget
) -> list[ColumnElement[bool]]:
    """Exact custody: invocation target kind/install plus the bound sandbox."""

    conditions: list[ColumnElement[bool]] = [
        invocation_target_exists(invocation_id, expected_target)
    ]
    if isinstance(expected_target, ManagedCloudTarget):
        conditions.append(
            WorkflowInvocationDelivery.cloud_sandbox_id == expected_target.cloud_sandbox_id
        )
    else:
        conditions.append(WorkflowInvocationDelivery.cloud_sandbox_id.is_(None))
    return conditions


def no_terminal_observation_condition() -> ColumnElement[bool]:
    """Terminal-first blocks loss: an already-projected terminal AnyHarness
    observation takes precedence over any loss proof (design §8.3)."""

    return WorkflowInvocationDelivery.runtime_observation_json.is_(None) | func.coalesce(
        WorkflowInvocationDelivery.runtime_observation_json["status"].astext, ""
    ).not_in(TERMINAL_OBSERVATION_STATUSES)


def has_terminal_observation(delivery: WorkflowDeliverySnapshot) -> bool:
    """Whether the projection already shows a terminal AnyHarness status —
    the run's result, after which cancellation has nothing left to do."""

    observation = delivery.runtime_observation_json
    return (
        isinstance(observation, dict)
        and observation.get("status") in TERMINAL_OBSERVATION_STATUSES
    )


def parse_document(text: str) -> dict[str, object]:
    return cast(dict[str, object], parse_canonical_json(text))


@dataclass(frozen=True)
class WorkflowInvocationSnapshot:
    id: UUID
    user_id: UUID
    workflow_definition_id: UUID | None
    definition_revision: int
    definition_schema_version: int
    validated_catalog_version: str
    title_snapshot: str
    idempotency_key: str
    request_hash: str
    arguments_json: dict[str, object]
    resolved_bundle_json: dict[str, object]
    bundle_digest: str
    target_kind: str
    desktop_install_id: str | None
    logical_placement_json: dict[str, object]
    resolved_placement_json: dict[str, object]
    created_at: datetime


@dataclass(frozen=True)
class WorkflowDeliverySnapshot:
    invocation_id: UUID
    status: str
    cloud_sandbox_id: str | None
    handoff_started_at: datetime | None
    attempt_count: int
    last_attempt_at: datetime | None
    runtime_payload_json: dict[str, object] | None
    runtime_payload_digest: str | None
    anyharness_run_id: str | None
    anyharness_workspace_id: str | None
    anyharness_data_epoch: str | None
    runtime_revision: int | None
    runtime_observation_json: dict[str, object] | None
    runtime_observed_at: datetime | None
    control_plane_runtime_outcome: str | None
    control_plane_runtime_outcome_at: datetime | None
    control_plane_runtime_outcome_reason: str | None
    cancel_requested_at: datetime | None
    error_code: str | None
    error_message: str | None
    accepted_at: datetime | None
    finished_at: datetime | None
    updated_at: datetime


def invocation_snapshot(row: WorkflowInvocation) -> WorkflowInvocationSnapshot:
    return WorkflowInvocationSnapshot(
        id=row.id,
        user_id=row.user_id,
        workflow_definition_id=row.workflow_definition_id,
        definition_revision=row.definition_revision,
        definition_schema_version=row.definition_schema_version,
        validated_catalog_version=row.validated_catalog_version,
        title_snapshot=row.title_snapshot,
        idempotency_key=row.idempotency_key,
        request_hash=row.request_hash,
        arguments_json=parse_document(row.arguments_json),
        resolved_bundle_json=parse_document(row.resolved_bundle_json),
        bundle_digest=row.bundle_digest,
        target_kind=row.target_kind,
        desktop_install_id=row.desktop_install_id,
        logical_placement_json=parse_document(row.logical_placement_json),
        resolved_placement_json=parse_document(row.resolved_placement_json),
        created_at=row.created_at,
    )


def delivery_snapshot(row: WorkflowInvocationDelivery) -> WorkflowDeliverySnapshot:
    return WorkflowDeliverySnapshot(
        invocation_id=row.invocation_id,
        status=row.status,
        cloud_sandbox_id=row.cloud_sandbox_id,
        handoff_started_at=row.handoff_started_at,
        attempt_count=row.attempt_count,
        last_attempt_at=row.last_attempt_at,
        runtime_payload_json=(
            None if row.runtime_payload_json is None else parse_document(row.runtime_payload_json)
        ),
        runtime_payload_digest=row.runtime_payload_digest,
        anyharness_run_id=row.anyharness_run_id,
        anyharness_workspace_id=row.anyharness_workspace_id,
        anyharness_data_epoch=row.anyharness_data_epoch,
        runtime_revision=row.runtime_revision,
        runtime_observation_json=(
            None
            if row.runtime_observation_json is None
            else dict(row.runtime_observation_json)
        ),
        runtime_observed_at=row.runtime_observed_at,
        control_plane_runtime_outcome=row.control_plane_runtime_outcome,
        control_plane_runtime_outcome_at=row.control_plane_runtime_outcome_at,
        control_plane_runtime_outcome_reason=row.control_plane_runtime_outcome_reason,
        cancel_requested_at=row.cancel_requested_at,
        error_code=row.error_code,
        error_message=row.error_message,
        accepted_at=row.accepted_at,
        finished_at=row.finished_at,
        updated_at=row.updated_at,
    )
