"""Integration tests for the workspace_move store (real Postgres).

Covers the reservation/idempotency-replay path, the legal-transition table
(no phase skips, no post-cutover fail-to-source), and the atomic cutover
flip. See specs/tbd/workspace-migration-v2.md section 2.2/2.3.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.cloud.repositories import RepoConfig
from proliferate.db.store import workspace_moves as store


async def _create_user(db_session: AsyncSession) -> uuid.UUID:
    user = User(
        email=f"workspace-move-{uuid.uuid4().hex[:10]}@example.com",
        hashed_password="unused-oauth-only",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    db_session.add(user)
    await db_session.flush()
    return user.id


async def _create_repo_config(db_session: AsyncSession, *, user_id: uuid.UUID) -> uuid.UUID:
    repo_config = RepoConfig(
        user_id=user_id,
        git_provider="github",
        git_owner="proliferate-ai",
        git_repo_name="proliferate",
    )
    db_session.add(repo_config)
    await db_session.flush()
    return repo_config.id


async def _reserve_move(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    repo_config_id: uuid.UUID,
    branch: str = "feature/move",
    idempotency_key: str | None = None,
):
    return await store.create_move(
        db_session,
        user_id=user_id,
        repo_config_id=repo_config_id,
        branch=branch,
        source_kind="local",
        destination_kind="cloud",
        source_ref={"desktopInstallId": "desktop-1"},
        destination_ref={},
        base_commit_sha="a" * 40,
        idempotency_key=idempotency_key or uuid.uuid4().hex,
    )


@pytest.mark.asyncio
async def test_create_move_reserves_started_row_with_canonical_source(
    db_session: AsyncSession,
) -> None:
    user_id = await _create_user(db_session)
    repo_config_id = await _create_repo_config(db_session, user_id=user_id)

    move = await _reserve_move(db_session, user_id=user_id, repo_config_id=repo_config_id)

    assert move is not None
    assert move.phase == "started"
    assert move.canonical_side == "source"
    assert move.source_ref == {"desktopInstallId": "desktop-1"}

    fetched = await store.get_move(db_session, move.id, user_id=user_id)
    assert fetched == move


@pytest.mark.asyncio
async def test_create_move_idempotency_key_replay_returns_same_row(
    db_session: AsyncSession,
) -> None:
    user_id = await _create_user(db_session)
    repo_config_id = await _create_repo_config(db_session, user_id=user_id)
    key = uuid.uuid4().hex

    first = await _reserve_move(
        db_session,
        user_id=user_id,
        repo_config_id=repo_config_id,
        idempotency_key=key,
    )
    second = await _reserve_move(
        db_session,
        user_id=user_id,
        repo_config_id=repo_config_id,
        idempotency_key=key,
    )

    assert first is not None
    assert second is not None
    assert first.id == second.id


@pytest.mark.asyncio
async def test_create_move_active_identity_conflict_returns_none(
    db_session: AsyncSession,
) -> None:
    user_id = await _create_user(db_session)
    repo_config_id = await _create_repo_config(db_session, user_id=user_id)

    first = await _reserve_move(
        db_session,
        user_id=user_id,
        repo_config_id=repo_config_id,
        branch="main",
    )
    assert first is not None

    conflict = await _reserve_move(
        db_session,
        user_id=user_id,
        repo_config_id=repo_config_id,
        branch="main",
    )
    assert conflict is None


@pytest.mark.asyncio
async def test_load_active_move_for_identity_ignores_terminal_moves(
    db_session: AsyncSession,
) -> None:
    user_id = await _create_user(db_session)
    repo_config_id = await _create_repo_config(db_session, user_id=user_id)

    move = await _reserve_move(
        db_session,
        user_id=user_id,
        repo_config_id=repo_config_id,
        branch="main",
    )
    assert move is not None

    active = await store.load_active_move_for_identity(
        db_session,
        user_id=user_id,
        repo_config_id=repo_config_id,
        branch="main",
    )
    assert active is not None
    assert active.id == move.id

    await store.fail_move(
        db_session,
        move.id,
        user_id=user_id,
        failure_code="destination_unreachable",
    )

    active_after_fail = await store.load_active_move_for_identity(
        db_session,
        user_id=user_id,
        repo_config_id=repo_config_id,
        branch="main",
    )
    assert active_after_fail is None

    # A new move for the same identity is allowed once the old one is terminal.
    reopened = await _reserve_move(
        db_session,
        user_id=user_id,
        repo_config_id=repo_config_id,
        branch="main",
    )
    assert reopened is not None
    assert reopened.id != move.id


@pytest.mark.asyncio
async def test_advance_phase_follows_the_happy_path(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    repo_config_id = await _create_repo_config(db_session, user_id=user_id)
    move = await _reserve_move(db_session, user_id=user_id, repo_config_id=repo_config_id)
    assert move is not None

    ready = await store.advance_phase(
        db_session,
        move.id,
        user_id=user_id,
        to_phase="destination_ready",
        destination_ref={"cloudWorkspaceId": "ws-1"},
    )
    assert ready is not None
    assert ready.phase == "destination_ready"
    assert ready.destination_ref == {"cloudWorkspaceId": "ws-1"}

    installed = await store.advance_phase(
        db_session,
        move.id,
        user_id=user_id,
        to_phase="installed",
    )
    assert installed is not None
    assert installed.phase == "installed"

    cutover = await store.commit_cutover(db_session, move.id, user_id=user_id)
    assert cutover is not None
    assert cutover.phase == "cutover"
    assert cutover.canonical_side == "destination"
    assert cutover.cutover_at is not None

    completed = await store.advance_phase(
        db_session,
        move.id,
        user_id=user_id,
        to_phase="completed",
    )
    assert completed is not None
    assert completed.phase == "completed"
    assert completed.completed_at is not None


@pytest.mark.asyncio
async def test_advance_phase_rejects_skipped_phase(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    repo_config_id = await _create_repo_config(db_session, user_id=user_id)
    move = await _reserve_move(db_session, user_id=user_id, repo_config_id=repo_config_id)
    assert move is not None

    with pytest.raises(store.IllegalPhaseTransition):
        await store.advance_phase(
            db_session,
            move.id,
            user_id=user_id,
            to_phase="installed",
        )


@pytest.mark.asyncio
async def test_fail_move_is_illegal_after_cutover(db_session: AsyncSession) -> None:
    user_id = await _create_user(db_session)
    repo_config_id = await _create_repo_config(db_session, user_id=user_id)
    move = await _reserve_move(db_session, user_id=user_id, repo_config_id=repo_config_id)
    assert move is not None

    await store.advance_phase(db_session, move.id, user_id=user_id, to_phase="destination_ready")
    await store.advance_phase(db_session, move.id, user_id=user_id, to_phase="installed")
    await store.commit_cutover(db_session, move.id, user_id=user_id)

    with pytest.raises(store.IllegalPhaseTransition):
        await store.fail_move(
            db_session,
            move.id,
            user_id=user_id,
            failure_code="cleanup_failed",
        )


@pytest.mark.asyncio
async def test_fail_move_is_legal_pre_cutover_and_records_failure(
    db_session: AsyncSession,
) -> None:
    user_id = await _create_user(db_session)
    repo_config_id = await _create_repo_config(db_session, user_id=user_id)
    move = await _reserve_move(db_session, user_id=user_id, repo_config_id=repo_config_id)
    assert move is not None

    failed = await store.fail_move(
        db_session,
        move.id,
        user_id=user_id,
        failure_code="destination_unreachable",
        failure_detail="sandbox failed to materialize",
    )
    assert failed is not None
    assert failed.phase == "failed"
    assert failed.canonical_side == "source"
    assert failed.failure_code == "destination_unreachable"
    assert failed.failure_detail == "sandbox failed to materialize"


@pytest.mark.asyncio
async def test_fail_move_leaves_source_ref_destination_ref_and_canonical_side_untouched(
    db_session: AsyncSession,
) -> None:
    """Failing pre-cutover must only touch phase/failure_code/failure_detail --
    the source's identity (source_ref, canonical_side, base_commit_sha) and
    whatever destination_ref was recorded so far are left exactly as they were,
    so "Source untouched -- retry/cancel" (spec section 2.6) is literally true.
    """
    user_id = await _create_user(db_session)
    repo_config_id = await _create_repo_config(db_session, user_id=user_id)
    move = await _reserve_move(db_session, user_id=user_id, repo_config_id=repo_config_id)
    assert move is not None
    assert move.source_ref == {"desktopInstallId": "desktop-1"}
    assert move.canonical_side == "source"

    ready = await store.advance_phase(
        db_session,
        move.id,
        user_id=user_id,
        to_phase="destination_ready",
        destination_ref={"cloudWorkspaceId": "ws-1", "anyharnessWorkspaceId": "ah-1"},
    )
    assert ready is not None

    failed = await store.fail_move(
        db_session,
        move.id,
        user_id=user_id,
        failure_code="destination_unreachable",
        failure_detail="sandbox failed to materialize",
    )
    assert failed is not None
    assert failed.phase == "failed"
    assert failed.failure_code == "destination_unreachable"

    # Untouched: the source side of the ledger is exactly what it was at
    # reservation time, and the destination_ref recorded so far is preserved
    # (not cleared) for diagnostics/retry.
    assert failed.source_ref == move.source_ref == {"desktopInstallId": "desktop-1"}
    assert failed.destination_ref == {"cloudWorkspaceId": "ws-1", "anyharnessWorkspaceId": "ah-1"}
    assert failed.canonical_side == "source"
    assert failed.base_commit_sha == move.base_commit_sha


@pytest.mark.asyncio
async def test_get_move_does_not_leak_across_users(db_session: AsyncSession) -> None:
    owner_id = await _create_user(db_session)
    other_user_id = await _create_user(db_session)
    repo_config_id = await _create_repo_config(db_session, user_id=owner_id)
    move = await _reserve_move(db_session, user_id=owner_id, repo_config_id=repo_config_id)
    assert move is not None

    assert await store.get_move(db_session, move.id, user_id=other_user_id) is None
