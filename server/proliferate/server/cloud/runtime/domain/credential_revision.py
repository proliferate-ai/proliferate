"""Pure credential freshness and restart decisions."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from proliferate.constants.cloud import SUPPORTED_CLOUD_AGENTS, CloudRuntimeEnvironmentStatus

CredentialFreshnessStatus = Literal[
    "current",
    "stale",
    "restart_required",
    "apply_failed",
    "missing_credentials",
]

CredentialRestartDecisionReason = Literal[
    "not_required",
    "restart_disallowed",
    "live_sessions",
    "allowed",
]

EMPTY_FILES_REVISION = "credential-files:v1:empty"
EMPTY_PROCESS_REVISION = "credential-process:v1:empty"


class CredentialRecordForRevision(Protocol):
    provider: str
    auth_mode: str
    payload_format: str
    id: object
    revoked_at: object | None


class CredentialFreshnessLike(Protocol):
    status: CredentialFreshnessStatus
    files_current: bool
    process_current: bool


@dataclass(frozen=True)
class CredentialRevisionPlan:
    files_revision: str
    process_revision: str
    missing_credentials: bool


@dataclass(frozen=True)
class CredentialFreshnessDecision:
    status: CredentialFreshnessStatus
    files_current: bool
    process_current: bool
    requires_restart: bool
    last_error: str | None
    last_error_at: datetime | None
    files_applied_at: datetime | None
    process_applied_at: datetime | None


@dataclass(frozen=True)
class CredentialProcessRestartDecision:
    allowed: bool
    reason: CredentialRestartDecisionReason


def filter_active_supported_credentials[CredentialRecordT: CredentialRecordForRevision](
    records: Iterable[CredentialRecordT],
    *,
    supported_providers: Iterable[str] = SUPPORTED_CLOUD_AGENTS,
) -> list[CredentialRecordT]:
    supported = frozenset(supported_providers)
    return [
        record for record in records if record.provider in supported and record.revoked_at is None
    ]


def build_credential_revision_plan(
    records: Iterable[CredentialRecordForRevision],
) -> CredentialRevisionPlan:
    active_records = filter_active_supported_credentials(records)
    return CredentialRevisionPlan(
        files_revision=_revision_for(active_records, "file", "credential-files"),
        process_revision=_revision_for(active_records, "env", "credential-process"),
        missing_credentials=not active_records,
    )


def classify_credential_freshness(
    *,
    runtime_status: str,
    active_sandbox_id: object | None,
    files_applied_revision: str | None,
    process_applied_revision: str | None,
    credential_last_error: str | None,
    credential_last_error_at: datetime | None,
    credential_files_applied_at: datetime | None,
    credential_process_applied_at: datetime | None,
    revisions: CredentialRevisionPlan,
) -> CredentialFreshnessDecision:
    assume_legacy_current = not revisions.missing_credentials
    files_current = revision_is_current(
        applied_revision=files_applied_revision,
        desired_revision=revisions.files_revision,
        assume_legacy_current=assume_legacy_current,
        runtime_status=runtime_status,
        active_sandbox_id=active_sandbox_id,
    )
    process_current = revision_is_current(
        applied_revision=process_applied_revision,
        desired_revision=revisions.process_revision,
        assume_legacy_current=assume_legacy_current,
        runtime_status=runtime_status,
        active_sandbox_id=active_sandbox_id,
    )
    requires_restart = not process_current
    if files_current and process_current:
        status: CredentialFreshnessStatus = (
            "missing_credentials" if revisions.missing_credentials else "current"
        )
    elif credential_last_error:
        status = "apply_failed"
    elif requires_restart:
        status = "restart_required"
    else:
        status = "stale"
    return CredentialFreshnessDecision(
        status=status,
        files_current=files_current,
        process_current=process_current,
        requires_restart=requires_restart,
        last_error=credential_last_error,
        last_error_at=credential_last_error_at,
        files_applied_at=credential_files_applied_at,
        process_applied_at=credential_process_applied_at,
    )


def revision_is_current(
    *,
    applied_revision: str | None,
    desired_revision: str,
    assume_legacy_current: bool,
    runtime_status: str,
    active_sandbox_id: object | None,
) -> bool:
    if applied_revision == desired_revision:
        return True
    return (
        applied_revision is None
        and assume_legacy_current
        and runtime_status == CloudRuntimeEnvironmentStatus.running.value
        and active_sandbox_id is not None
    )


def credential_apply_is_already_current(
    decision: CredentialFreshnessLike,
    revisions: CredentialRevisionPlan,
) -> bool:
    return decision.status == "current" or (
        revisions.missing_credentials and decision.files_current and decision.process_current
    )


def decide_process_credential_restart(
    *,
    requires_restart: bool,
    allow_process_restart: bool,
    runtime_has_live_sessions: bool,
) -> CredentialProcessRestartDecision:
    if not requires_restart:
        return CredentialProcessRestartDecision(allowed=False, reason="not_required")
    if not allow_process_restart:
        return CredentialProcessRestartDecision(allowed=False, reason="restart_disallowed")
    if runtime_has_live_sessions:
        return CredentialProcessRestartDecision(allowed=False, reason="live_sessions")
    return CredentialProcessRestartDecision(allowed=True, reason="allowed")


def _revision_for(
    records: Iterable[CredentialRecordForRevision],
    auth_mode: str,
    prefix: str,
) -> str:
    parts = sorted(
        f"{record.provider}:{record.auth_mode}:{record.payload_format}:{record.id}"
        for record in records
        if record.auth_mode == auth_mode
    )
    if not parts:
        return EMPTY_FILES_REVISION if auth_mode == "file" else EMPTY_PROCESS_REVISION
    return f"{prefix}:v1:{','.join(parts)}"
