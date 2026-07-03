"""Persistence helpers for ``workspace_move`` rows.

See ``specs/tbd/workspace-migration-v2.md`` section 2.2 for the data model
and section 2.3 for the phase sequencing this module enforces. A move is a
durable ledger entry; the store never talks to a runtime or another domain
-- it only manages the row's lifecycle:

    started -> destination_ready -> installed -> cutover -> completed
                    \\-> failed        \\-> failed   \\-> failed

Once a move reaches ``cutover`` it can no longer fail back to the source
(the canonical side has already flipped); the only legal move from
``cutover`` is ``completed``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.cloud.workspace_moves import WorkspaceMove
from proliferate.utils.time import utcnow

_UNSET: Final = object()

# Terminal phases: no further phase transition is legal from these.
TERMINAL_PHASES: Final[frozenset[str]] = frozenset({"completed", "failed"})

# The legal-transition table (spec 2.2/2.3): no phase skips, and no
# post-cutover fail-to-source -- "cutover" may only ever advance to
# "completed".
_LEGAL_TRANSITIONS: Final[dict[str, frozenset[str]]] = {
    "started": frozenset({"destination_ready", "failed"}),
    "destination_ready": frozenset({"installed", "failed"}),
    "installed": frozenset({"cutover", "failed"}),
    "cutover": frozenset({"completed"}),
    "completed": frozenset(),
    "failed": frozenset(),
}


class IllegalPhaseTransition(Exception):
    """Raised when a requested phase transition is not in the legal-transition table."""

    def __init__(self, *, from_phase: str, to_phase: str) -> None:
        self.from_phase = from_phase
        self.to_phase = to_phase
        super().__init__(
            f"illegal workspace_move phase transition: {from_phase!r} -> {to_phase!r}"
        )


def _require_legal_transition(from_phase: str, to_phase: str) -> None:
    if to_phase not in _LEGAL_TRANSITIONS.get(from_phase, frozenset()):
        raise IllegalPhaseTransition(from_phase=from_phase, to_phase=to_phase)


@dataclass(frozen=True)
class WorkspaceMoveValue:
    id: UUID
    user_id: UUID
    repo_config_id: UUID
    branch: str
    source_kind: str
    destination_kind: str
    source_ref: dict[str, object]
    destination_ref: dict[str, object]
    base_commit_sha: str
    phase: str
    canonical_side: str
    failure_code: str | None
    failure_detail: str | None
    idempotency_key: str
    created_at: datetime
    updated_at: datetime
    cutover_at: datetime | None
    completed_at: datetime | None


def workspace_move_value(row: WorkspaceMove) -> WorkspaceMoveValue:
    return WorkspaceMoveValue(
        id=row.id,
        user_id=row.user_id,
        repo_config_id=row.repo_config_id,
        branch=row.branch,
        source_kind=row.source_kind,
        destination_kind=row.destination_kind,
        source_ref=dict(row.source_ref),
        destination_ref=dict(row.destination_ref),
        base_commit_sha=row.base_commit_sha,
        phase=row.phase,
        canonical_side=row.canonical_side,
        failure_code=row.failure_code,
        failure_detail=row.failure_detail,
        idempotency_key=row.idempotency_key,
        created_at=row.created_at,
        updated_at=row.updated_at,
        cutover_at=row.cutover_at,
        completed_at=row.completed_at,
    )


async def _load_move_row(
    db: AsyncSession,
    move_id: UUID,
    *,
    user_id: UUID,
    lock_row: bool = False,
) -> WorkspaceMove | None:
    stmt = select(WorkspaceMove).where(
        WorkspaceMove.id == move_id,
        WorkspaceMove.user_id == user_id,
    )
    if lock_row:
        stmt = stmt.with_for_update()
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_move(
    db: AsyncSession,
    move_id: UUID,
    *,
    user_id: UUID,
) -> WorkspaceMoveValue | None:
    """Load a move scoped to its owner; returns None if missing or not owned by user_id."""
    row = await _load_move_row(db, move_id, user_id=user_id)
    return workspace_move_value(row) if row is not None else None


async def get_move_by_idempotency_key(
    db: AsyncSession,
    *,
    user_id: UUID,
    idempotency_key: str,
) -> WorkspaceMoveValue | None:
    row = (
        await db.execute(
            select(WorkspaceMove).where(
                WorkspaceMove.user_id == user_id,
                WorkspaceMove.idempotency_key == idempotency_key,
            )
        )
    ).scalar_one_or_none()
    return workspace_move_value(row) if row is not None else None


async def load_active_move_for_identity(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_config_id: UUID,
    branch: str,
    lock_row: bool = False,
) -> WorkspaceMoveValue | None:
    """The non-terminal move (if any) for (user_id, repo_config_id, branch).

    Mirrors the partial unique index ``ux_workspace_move_active_identity``:
    at most one non-terminal row can exist per identity.
    """
    stmt = select(WorkspaceMove).where(
        WorkspaceMove.user_id == user_id,
        WorkspaceMove.repo_config_id == repo_config_id,
        WorkspaceMove.branch == branch,
        WorkspaceMove.phase.not_in(TERMINAL_PHASES),
    )
    if lock_row:
        stmt = stmt.with_for_update()
    row = (await db.execute(stmt)).scalar_one_or_none()
    return workspace_move_value(row) if row is not None else None


async def create_move(
    db: AsyncSession,
    *,
    user_id: UUID,
    repo_config_id: UUID,
    branch: str,
    source_kind: str,
    destination_kind: str,
    source_ref: dict[str, object],
    destination_ref: dict[str, object],
    base_commit_sha: str,
    idempotency_key: str,
) -> WorkspaceMoveValue | None:
    """Reserve a workspace_move row in phase="started"/canonical_side="source".

    Idempotency-key replay: a prior call with the same (user_id,
    idempotency_key) returns that same row unchanged rather than inserting
    a duplicate.

    Returns None when a *different* idempotency key collides with the
    partial-unique "one non-terminal move per identity" constraint (an
    active move already exists for this user/repo_config/branch under
    another key) -- the caller decides how to surface that conflict.
    """
    existing = await get_move_by_idempotency_key(
        db, user_id=user_id, idempotency_key=idempotency_key
    )
    if existing is not None:
        return existing

    now = utcnow()
    row = WorkspaceMove(
        user_id=user_id,
        repo_config_id=repo_config_id,
        branch=branch,
        source_kind=source_kind,
        destination_kind=destination_kind,
        source_ref=source_ref,
        destination_ref=destination_ref,
        base_commit_sha=base_commit_sha,
        phase="started",
        canonical_side="source",
        idempotency_key=idempotency_key,
        created_at=now,
        updated_at=now,
    )
    try:
        async with db.begin_nested():
            db.add(row)
            await db.flush()
    except IntegrityError:
        # Disambiguate: a concurrent request with the same idempotency key
        # raced us (replay it), versus a genuine identity collision (signal
        # the caller with None).
        replay = await get_move_by_idempotency_key(
            db, user_id=user_id, idempotency_key=idempotency_key
        )
        if replay is not None:
            return replay
        return None
    return workspace_move_value(row)


async def advance_phase(
    db: AsyncSession,
    move_id: UUID,
    *,
    user_id: UUID,
    to_phase: str,
    destination_ref: dict[str, object] | None | object = _UNSET,
) -> WorkspaceMoveValue | None:
    """Advance a move to ``to_phase``, enforcing the legal-transition table.

    Raises IllegalPhaseTransition on a skipped or backward phase (including
    fail-after-cutover). Returns None only when the row itself is missing.
    """
    row = await _load_move_row(db, move_id, user_id=user_id, lock_row=True)
    if row is None:
        return None
    _require_legal_transition(row.phase, to_phase)
    row.phase = to_phase
    if destination_ref is not _UNSET:
        row.destination_ref = destination_ref  # type: ignore[assignment]
    if to_phase == "completed":
        row.completed_at = utcnow()
    row.updated_at = utcnow()
    await db.flush()
    return workspace_move_value(row)


async def commit_cutover(
    db: AsyncSession,
    move_id: UUID,
    *,
    user_id: UUID,
) -> WorkspaceMoveValue | None:
    """Atomically flip canonical_side to destination and advance phase=cutover.

    Callers that also need cloud-side bookkeeping (archiving the source
    cloud_workspace, etc.) must perform it in the same session/transaction
    as this call -- the store never commits.
    """
    row = await _load_move_row(db, move_id, user_id=user_id, lock_row=True)
    if row is None:
        return None
    _require_legal_transition(row.phase, "cutover")
    now = utcnow()
    row.phase = "cutover"
    row.canonical_side = "destination"
    row.cutover_at = now
    row.updated_at = now
    await db.flush()
    return workspace_move_value(row)


async def fail_move(
    db: AsyncSession,
    move_id: UUID,
    *,
    user_id: UUID,
    failure_code: str,
    failure_detail: str | None = None,
) -> WorkspaceMoveValue | None:
    """Move to phase="failed"; illegal (raises) once the row has cut over."""
    row = await _load_move_row(db, move_id, user_id=user_id, lock_row=True)
    if row is None:
        return None
    _require_legal_transition(row.phase, "failed")
    row.phase = "failed"
    row.failure_code = failure_code
    row.failure_detail = failure_detail
    row.updated_at = utcnow()
    await db.flush()
    return workspace_move_value(row)
