"""DB-backed intent/report/unlink + dual-write/read-fallback tests for the ledger.

These exercise the materialization service against a real Postgres schema with
the AnyHarness git-status read and GitHub branch-head read monkeypatched. They
cover: clean/published intent success and every typed git blocker, publication
mismatch, exact/wrong-SHA/wrong-branch reports, stale generation, the
completion-vs-unlink race, concurrent-intent convergence, active uniqueness,
redaction, selection preference, dual-write on create, and legacy fallback.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.cloud.repositories import RepoConfig, RepoEnvironment
from proliferate.db.models.cloud.runtime_workers import CloudRuntimeWorker
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.integrations.anyharness.models import RemoteGitStatusSnapshot
from proliferate.integrations.github.repos import GitHubRepoBranches
from proliferate.server.cloud.errors import CloudApiError
from proliferate.integrations.anyharness.models import ResolvedRemoteWorkspace
from proliferate.server.cloud.workspaces import service as workspaces_service
from proliferate.server.cloud.workspaces.materializations import (
    service as materializations_service,
)
from proliferate.server.cloud.workspaces.models import (
    CreateCloudWorkspaceRequest,
    CreateMaterializationIntentRequest,
    ReportMaterializationRequest,
)

_INSTALL = "mac-a"
_HEAD = "abc123def456"
_BRANCH = "feat/x"


async def _seed(db: AsyncSession, *, with_sandbox: bool = True, with_worker: bool = True):
    now = datetime.now(UTC)
    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4()}@test.local",
        hashed_password="",
        is_active=True,
        is_superuser=False,
        is_verified=False,
    )
    db.add(user)
    cfg = RepoConfig(
        id=uuid.uuid4(),
        user_id=user.id,
        git_provider="github",
        git_owner="acme",
        git_repo_name="widgets",
        commit_instructions="",
    )
    db.add(cfg)
    env = RepoEnvironment(
        id=uuid.uuid4(),
        repo_config_id=cfg.id,
        environment_kind="cloud",
        setup_script="",
        run_command="",
        default_branch="main",
    )
    db.add(env)
    sandbox = None
    if with_sandbox:
        sandbox = CloudSandbox(
            id=uuid.uuid4(),
            owner_user_id=user.id,
            sandbox_type="e2b",
            status="ready",
        )
        db.add(sandbox)
    if with_worker:
        db.add(
            CloudRuntimeWorker(
                id=uuid.uuid4(),
                owner_user_id=user.id,
                runtime_kind="desktop",
                desktop_install_id=_INSTALL,
                token_hash=uuid.uuid4().hex,
                status="online",
                enrolled_at=now,
                last_seen_at=now,
            )
        )
    ws = CloudWorkspace(
        id=uuid.uuid4(),
        owner_user_id=user.id,
        repo_environment_id=env.id,
        display_name="ws",
        git_branch=_BRANCH,
        git_base_branch="main",
        anyharness_workspace_id="ah-managed",
        created_at=now,
        updated_at=now,
    )
    db.add(ws)
    await db.flush()
    return SimpleNamespace(user=user, env=env, sandbox=sandbox, workspace=ws)


async def _seed_managed_materialization(db: AsyncSession, seed) -> None:
    from proliferate.db.store import cloud_workspace_materializations as store

    await store.insert_managed_cloud_materialization(
        db,
        cloud_workspace_id=seed.workspace.id,
        cloud_sandbox_id=seed.sandbox.id if seed.sandbox is not None else None,
        anyharness_workspace_id="ah-managed",
        state="hydrated",
    )
    await db.flush()


def _snapshot(**overrides: object) -> RemoteGitStatusSnapshot:
    base = dict(
        workspace_id="ah-managed",
        workspace_path="/w/ws",
        repo_root_path="/w",
        current_branch=_BRANCH,
        head_oid=_HEAD,
        detached=False,
        upstream_branch=f"origin/{_BRANCH}",
        suggested_base_branch="main",
        ahead=0,
        behind=0,
        operation="none",
        conflicted=False,
        clean=True,
    )
    base.update(overrides)
    return RemoteGitStatusSnapshot(**base)  # type: ignore[arg-type]


def _patch_preflight(
    monkeypatch: pytest.MonkeyPatch,
    *,
    snapshot: RemoteGitStatusSnapshot,
    branch_heads: dict[str, str] | None = None,
) -> None:
    async def _status(*_a: Any, **_k: Any) -> RemoteGitStatusSnapshot:
        return snapshot

    async def _runtime_access(*_a: Any, **_k: Any):
        return ("https://runtime.invalid", "token", "data-key")

    async def _authority(*_a: Any, **_k: Any):
        return SimpleNamespace(access_token="gho_test")

    async def _branches(*_a: Any, **_k: Any) -> GitHubRepoBranches:
        heads = branch_heads if branch_heads is not None else {_BRANCH: _HEAD}
        return GitHubRepoBranches(
            default_branch="main",
            branches=["main", _BRANCH],
            branch_heads_by_name=heads,
        )

    monkeypatch.setattr(materializations_service, "get_runtime_git_status", _status)
    monkeypatch.setattr(
        materializations_service.cloud_sandboxes_service,
        "load_cloud_sandbox_runtime_access",
        _runtime_access,
    )
    monkeypatch.setattr(
        materializations_service, "require_github_cloud_repo_authority", _authority
    )
    monkeypatch.setattr(materializations_service, "get_repo_branches_for_credentials", _branches)


async def _intent(db, seed, body_install: str = _INSTALL):
    return await materializations_service.create_local_materialization_intent(
        db,
        user_id=seed.user.id,
        workspace_id=seed.workspace.id,
        body=CreateMaterializationIntentRequest(
            targetKind="local_desktop", desktopInstallId=body_install
        ),
    )


@pytest.mark.asyncio
async def test_intent_success_clean_published_source(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())

    result = await _intent(db_session, seed)

    assert result.materialization.target_kind == "local_desktop"
    assert result.materialization.state == "pending"
    assert result.materialization.expected_head_sha == _HEAD
    assert result.source.branch_name == _BRANCH
    assert result.source.head_sha == _HEAD
    mat = result.materialization
    assert result.operation_id == f"{mat.id}:{mat.generation}"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"clean": False}, "materialization_source_blocked"),
        ({"conflicted": True}, "materialization_source_blocked"),
        ({"detached": True, "current_branch": None}, "materialization_source_blocked"),
        ({"operation": "rebase"}, "materialization_source_blocked"),
        ({"upstream_branch": None}, "materialization_source_blocked"),
        ({"ahead": 3}, "materialization_source_blocked"),
    ],
)
async def test_intent_git_blockers(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    overrides: dict[str, object],
    code: str,
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot(**overrides))

    with pytest.raises(CloudApiError) as excinfo:
        await _intent(db_session, seed)
    assert excinfo.value.code == code


@pytest.mark.asyncio
async def test_intent_blocked_when_head_not_published(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    # GitHub head differs from the observed AnyHarness head.
    _patch_preflight(monkeypatch, snapshot=_snapshot(), branch_heads={_BRANCH: "different"})

    with pytest.raises(CloudApiError) as excinfo:
        await _intent(db_session, seed)
    assert excinfo.value.code == "materialization_source_blocked"


@pytest.mark.asyncio
async def test_intent_blocked_when_branch_absent_on_github(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot(), branch_heads={"main": "x"})

    with pytest.raises(CloudApiError) as excinfo:
        await _intent(db_session, seed)
    assert excinfo.value.code == "materialization_source_blocked"


@pytest.mark.asyncio
async def test_intent_requires_owned_install(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session, with_worker=False)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())

    with pytest.raises(CloudApiError) as excinfo:
        await _intent(db_session, seed)
    assert excinfo.value.code == "desktop_install_not_owned"


@pytest.mark.asyncio
async def test_concurrent_intents_converge_to_one_active_row(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())

    first = await _intent(db_session, seed)
    second = await _intent(db_session, seed)

    assert first.materialization.id == second.materialization.id
    # PR4-GENERATION-01: a second intent while the first is still in-flight is an
    # idempotent replay — SAME row, SAME generation, SAME operationId. It must NOT
    # bump the generation (that would hand a crash-retry a fresh operationId and
    # let PR 3 cut a second worktree).
    assert second.materialization.generation == first.materialization.generation
    assert second.operation_id == first.operation_id
    assert second.source.head_sha == first.source.head_sha
    assert second.source.branch_name == first.source.branch_name

    from proliferate.db.store import cloud_workspace_materializations as store

    active = await store.list_active_materializations_for_workspace(
        db_session, cloud_workspace_id=seed.workspace.id
    )
    locals_ = [m for m in active if m.target_kind == "local_desktop"]
    assert len(locals_) == 1


@pytest.mark.asyncio
async def test_crash_retry_replays_same_generation_and_operation_id(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PR4-GENERATION-01: intent → (crash, no report) → intent again is a replay.

    The second call must return the SAME generation and operationId so PR 3
    re-issues the same per-step ids and replays its ledger result rather than
    cutting a second worktree.
    """
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())

    first = await _intent(db_session, seed)
    # No report arrives (the desktop crashed mid-materialization). The row stays
    # pending/in-flight. A retry re-issues the intent.
    retry = await _intent(db_session, seed)

    assert retry.materialization.id == first.materialization.id
    assert retry.materialization.generation == first.materialization.generation
    assert retry.operation_id == first.operation_id
    assert retry.materialization.state == "pending"

    from proliferate.db.store import cloud_workspace_materializations as store

    active = await store.list_active_materializations_for_workspace(
        db_session, cloud_workspace_id=seed.workspace.id
    )
    assert len([m for m in active if m.target_kind == "local_desktop"]) == 1


@pytest.mark.asyncio
async def test_reintent_after_hydrated_bumps_generation(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PR4-GENERATION-01: a re-intent over a HYDRATED row is a relink/recreate.

    The prior generation is terminal, so the new intent legitimately bumps the
    generation (fresh operationId) and PR 3 does new work.
    """
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())

    first = await _intent(db_session, seed)
    await materializations_service.report_materialization(
        db_session,
        user_id=seed.user.id,
        workspace_id=seed.workspace.id,
        materialization_id=uuid.UUID(first.materialization.id),
        body=ReportMaterializationRequest(
            generation=first.materialization.generation,
            state="hydrated",
            observedHeadSha=_HEAD,
            observedBranch=_BRANCH,
            worktreePath="/local/path",
            anyharnessWorkspaceId="ah-local",
        ),
    )

    reintent = await _intent(db_session, seed)
    assert reintent.materialization.id == first.materialization.id
    assert reintent.materialization.generation == first.materialization.generation + 1
    assert reintent.operation_id != first.operation_id
    assert reintent.materialization.state == "pending"


@pytest.mark.asyncio
async def test_reintent_after_failed_bumps_generation(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PR4-GENERATION-01: a re-intent over a FAILED row is a legitimate new attempt.

    The prior generation is terminal, so the new intent bumps the generation.
    """
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())

    first = await _intent(db_session, seed)
    await materializations_service.report_materialization(
        db_session,
        user_id=seed.user.id,
        workspace_id=seed.workspace.id,
        materialization_id=uuid.UUID(first.materialization.id),
        body=ReportMaterializationRequest(
            generation=first.materialization.generation,
            state="failed",
            failureCode="clone_failed",
            failureDetail="disk full",
        ),
    )

    reintent = await _intent(db_session, seed)
    assert reintent.materialization.id == first.materialization.id
    assert reintent.materialization.generation == first.materialization.generation + 1
    assert reintent.operation_id != first.operation_id
    assert reintent.materialization.state == "pending"


@pytest.mark.asyncio
async def test_report_exact_sha_and_branch_hydrates(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())
    intent = await _intent(db_session, seed)

    updated = await materializations_service.report_materialization(
        db_session,
        user_id=seed.user.id,
        workspace_id=seed.workspace.id,
        materialization_id=uuid.UUID(intent.materialization.id),
        body=ReportMaterializationRequest(
            generation=intent.materialization.generation,
            state="hydrated",
            observedHeadSha=_HEAD,
            observedBranch=_BRANCH,
            worktreePath="/local/path",
            anyharnessWorkspaceId="ah-local",
        ),
    )
    assert updated.state == "hydrated"
    assert updated.worktree_path == "/local/path"


@pytest.mark.asyncio
async def test_report_wrong_sha_rejected(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())
    intent = await _intent(db_session, seed)

    with pytest.raises(CloudApiError) as excinfo:
        await materializations_service.report_materialization(
            db_session,
            user_id=seed.user.id,
            workspace_id=seed.workspace.id,
            materialization_id=uuid.UUID(intent.materialization.id),
            body=ReportMaterializationRequest(
                generation=intent.materialization.generation,
                state="hydrated",
                observedHeadSha="wrong",
                observedBranch=_BRANCH,
            ),
        )
    assert excinfo.value.code == "materialization_sha_mismatch"


@pytest.mark.asyncio
async def test_report_wrong_branch_rejected(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())
    intent = await _intent(db_session, seed)

    with pytest.raises(CloudApiError) as excinfo:
        await materializations_service.report_materialization(
            db_session,
            user_id=seed.user.id,
            workspace_id=seed.workspace.id,
            materialization_id=uuid.UUID(intent.materialization.id),
            body=ReportMaterializationRequest(
                generation=intent.materialization.generation,
                state="hydrated",
                observedHeadSha=_HEAD,
                observedBranch="other",
            ),
        )
    assert excinfo.value.code == "materialization_branch_mismatch"


@pytest.mark.asyncio
async def test_report_stale_generation_rejected_without_mutation(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())
    intent = await _intent(db_session, seed)

    with pytest.raises(CloudApiError) as excinfo:
        await materializations_service.report_materialization(
            db_session,
            user_id=seed.user.id,
            workspace_id=seed.workspace.id,
            materialization_id=uuid.UUID(intent.materialization.id),
            body=ReportMaterializationRequest(
                generation=intent.materialization.generation - 1,
                state="hydrated",
                observedHeadSha=_HEAD,
                observedBranch=_BRANCH,
            ),
        )
    assert excinfo.value.code == "stale_materialization_generation"

    from proliferate.db.store import cloud_workspace_materializations as store

    row = await store.load_materialization(db_session, uuid.UUID(intent.materialization.id))
    assert row is not None and row.state == "pending"


@pytest.mark.asyncio
async def test_completion_racing_unlink_loses_via_generation(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())
    intent = await _intent(db_session, seed)
    mat_id = uuid.UUID(intent.materialization.id)
    stale_generation = intent.materialization.generation

    # Unlink bumps generation and soft-deletes.
    await materializations_service.unlink_materialization(
        db_session,
        user_id=seed.user.id,
        workspace_id=seed.workspace.id,
        materialization_id=mat_id,
    )

    # A completion report carrying the pre-unlink generation must lose.
    with pytest.raises(CloudApiError) as excinfo:
        await materializations_service.report_materialization(
            db_session,
            user_id=seed.user.id,
            workspace_id=seed.workspace.id,
            materialization_id=mat_id,
            body=ReportMaterializationRequest(
                generation=stale_generation,
                state="hydrated",
                observedHeadSha=_HEAD,
                observedBranch=_BRANCH,
            ),
        )
    assert excinfo.value.code == "stale_materialization_generation"

    from proliferate.db.store import cloud_workspace_materializations as store

    row = await store.load_materialization(db_session, mat_id)
    assert row is not None and row.unlinked_at is not None


@pytest.mark.asyncio
async def test_unlink_only_local_and_is_non_destructive(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())
    intent = await _intent(db_session, seed)

    from proliferate.db.store import cloud_workspace_materializations as store

    managed = await store.get_active_managed_cloud_materialization(
        db_session, cloud_workspace_id=seed.workspace.id
    )
    assert managed is not None

    # Managed rows cannot be unlinked through this action.
    with pytest.raises(CloudApiError) as excinfo:
        await materializations_service.unlink_materialization(
            db_session,
            user_id=seed.user.id,
            workspace_id=seed.workspace.id,
            materialization_id=managed.id,
        )
    assert excinfo.value.code == "materialization_not_unlinkable"

    await materializations_service.unlink_materialization(
        db_session,
        user_id=seed.user.id,
        workspace_id=seed.workspace.id,
        materialization_id=uuid.UUID(intent.materialization.id),
    )
    # Managed row and the workspace itself untouched.
    still_managed = await store.get_active_managed_cloud_materialization(
        db_session, cloud_workspace_id=seed.workspace.id
    )
    assert still_managed is not None
    ws = await db_session.get(CloudWorkspace, seed.workspace.id)
    assert ws is not None and ws.anyharness_workspace_id == "ah-managed"


@pytest.mark.asyncio
async def test_read_selection_and_redaction(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())
    intent = await _intent(db_session, seed)
    # Hydrate the local row so it is a healthy selection candidate.
    await materializations_service.report_materialization(
        db_session,
        user_id=seed.user.id,
        workspace_id=seed.workspace.id,
        materialization_id=uuid.UUID(intent.materialization.id),
        body=ReportMaterializationRequest(
            generation=intent.materialization.generation,
            state="hydrated",
            observedHeadSha=_HEAD,
            observedBranch=_BRANCH,
            worktreePath="/local/path",
            anyharnessWorkspaceId="ah-local",
        ),
    )

    # With the owned install: local preferred, own path disclosed.
    with_install = await workspaces_service.get_cloud_workspace_detail(
        db_session, seed.user.id, seed.workspace.id, desktop_install_id=_INSTALL
    )
    assert with_install.primary_materialization is not None
    assert with_install.primary_materialization.target_kind == "local_desktop"
    local_summary = next(
        m for m in with_install.materializations if m.target_kind == "local_desktop"
    )
    assert local_summary.worktree_path == "/local/path"

    # Without the install (Web/Mobile): managed preferred, local path redacted.
    without_install = await workspaces_service.get_cloud_workspace_detail(
        db_session, seed.user.id, seed.workspace.id
    )
    assert without_install.primary_materialization is not None
    assert without_install.primary_materialization.target_kind == "managed_cloud"
    local_redacted = next(
        m for m in without_install.materializations if m.target_kind == "local_desktop"
    )
    assert local_redacted.worktree_path is None
    assert local_redacted.anyharness_workspace_id is None
    # Presence/health still visible.
    assert local_redacted.state == "hydrated"


@pytest.mark.asyncio
async def test_legacy_fallback_read_without_ledger_row(db_session: AsyncSession) -> None:
    # Workspace with a legacy top-level id but no ledger row (pre-migration shape).
    seed = await _seed(db_session)
    detail = await workspaces_service.get_cloud_workspace_detail(
        db_session, seed.user.id, seed.workspace.id
    )
    assert detail.primary_materialization is not None
    assert detail.primary_materialization.target_kind == "managed_cloud"
    assert detail.primary_materialization.anyharness_workspace_id == "ah-managed"


@pytest.mark.asyncio
async def test_null_id_workspace_has_no_materialization(db_session: AsyncSession) -> None:
    seed = await _seed(db_session)
    ws = await db_session.get(CloudWorkspace, seed.workspace.id)
    assert ws is not None
    ws.anyharness_workspace_id = None
    await db_session.flush()

    detail = await workspaces_service.get_cloud_workspace_detail(
        db_session, seed.user.id, seed.workspace.id
    )
    assert detail.materializations == []
    assert detail.primary_materialization is None


@pytest.mark.asyncio
async def test_destroyed_sandbox_presents_managed_missing(db_session: AsyncSession) -> None:
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    seed.sandbox.status = "destroyed"
    seed.sandbox.destroyed_at = datetime.now(UTC)
    await db_session.flush()

    detail = await workspaces_service.get_cloud_workspace_detail(
        db_session, seed.user.id, seed.workspace.id
    )
    managed = next(m for m in detail.materializations if m.target_kind == "managed_cloud")
    assert managed.state == "missing"

    from proliferate.db.store import cloud_workspace_materializations as store

    # The persisted row is untouched (presentation-only overlay).
    row = await store.get_active_managed_cloud_materialization(
        db_session, cloud_workspace_id=seed.workspace.id
    )
    assert row is not None and row.state == "hydrated"


@pytest.mark.asyncio
async def test_create_dual_writes_legacy_id_and_managed_materialization(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from proliferate.db.store import cloud_workspace_materializations as store

    # Seed a user + repo config/env + active sandbox (no workspace yet).
    seed = await _seed(db_session, with_worker=False)
    ws = await db_session.get(CloudWorkspace, seed.workspace.id)
    assert ws is not None
    await db_session.delete(ws)
    await db_session.flush()

    async def _get_repo_environment(*_a: Any, **_k: Any) -> Any:
        return SimpleNamespace(
            id=seed.env.id,
            git_provider="github",
            git_owner="acme",
            git_repo_name="widgets",
            default_branch="main",
            setup_script="",
            environment_kind="cloud",
        )

    async def _authority(*_a: Any, **_k: Any) -> Any:
        return SimpleNamespace(access_token="gho_test")

    async def _branches(*_a: Any, **_k: Any) -> Any:
        return SimpleNamespace(branches=["main"], default_branch="main")

    async def _materialize(*_a: Any, **_k: Any) -> None:
        return None

    async def _runtime_access(*_a: Any, **_k: Any):
        return ("https://runtime.invalid", "token", "data-key")

    async def _resolve_root(*_a: Any, **_k: Any) -> ResolvedRemoteWorkspace:
        return ResolvedRemoteWorkspace(workspace_id="ignored", repo_root_id="root-1")

    async def _create_worktree(*_a: Any, **_k: Any) -> ResolvedRemoteWorkspace:
        return ResolvedRemoteWorkspace(workspace_id="ah-created", repo_root_id="root-1")

    monkeypatch.setattr(
        workspaces_service.repositories_store, "get_cloud_repo_environment", _get_repo_environment
    )
    monkeypatch.setattr(
        workspaces_service.repositories_store, "get_repo_environment_by_id", _get_repo_environment
    )
    monkeypatch.setattr(workspaces_service, "require_github_cloud_repo_authority", _authority)
    monkeypatch.setattr(workspaces_service, "get_repo_branches_for_credentials", _branches)
    monkeypatch.setattr(
        workspaces_service.materialization_service, "materialize_repo_environment", _materialize
    )
    monkeypatch.setattr(
        workspaces_service.cloud_sandboxes_service,
        "load_cloud_sandbox_runtime_access",
        _runtime_access,
    )
    monkeypatch.setattr(
        workspaces_service.cloud_sandboxes_service,
        "require_cloud_provisioning_configured",
        lambda: None,
    )
    monkeypatch.setattr(workspaces_service, "_resolve_repo_root", _resolve_root)
    monkeypatch.setattr(workspaces_service, "_create_anyharness_worktree", _create_worktree)

    detail = await workspaces_service.create_cloud_workspace_for_user(
        db_session,
        SimpleNamespace(id=seed.user.id),
        CreateCloudWorkspaceRequest(
            gitOwner="acme", gitRepoName="widgets", branchName="feat/new", baseBranch="main"
        ),
    )

    assert detail.anyharness_workspace_id == "ah-created"
    assert detail.primary_materialization is not None
    assert detail.primary_materialization.target_kind == "managed_cloud"
    assert detail.primary_materialization.anyharness_workspace_id == "ah-created"

    managed = await store.get_active_managed_cloud_materialization(
        db_session, cloud_workspace_id=uuid.UUID(detail.id)
    )
    assert managed is not None
    assert managed.state == "hydrated"
    assert managed.cloud_sandbox_id == seed.sandbox.id


def _patch_exact_ref_create(
    monkeypatch: pytest.MonkeyPatch,
    seed,
    *,
    branch_heads: dict[str, str],
    materialized_head: str,
    calls: dict[str, Any] | None = None,
) -> None:
    from proliferate.integrations.anyharness.models import MaterializedRemoteWorkspaceAtRef

    async def _get_repo_environment(*_a: Any, **_k: Any) -> Any:
        return SimpleNamespace(
            id=seed.env.id,
            git_provider="github",
            git_owner="acme",
            git_repo_name="widgets",
            default_branch="main",
            setup_script="",
            environment_kind="cloud",
        )

    async def _authority(*_a: Any, **_k: Any) -> Any:
        return SimpleNamespace(access_token="gho_test")

    async def _branches(*_a: Any, **_k: Any) -> GitHubRepoBranches:
        return GitHubRepoBranches(
            default_branch="main",
            branches=["main", *branch_heads.keys()],
            branch_heads_by_name=branch_heads,
        )

    async def _materialize(*_a: Any, **_k: Any) -> None:
        return None

    async def _runtime_access(*_a: Any, **_k: Any):
        return ("https://runtime.invalid", "token", "data-key")

    async def _resolve_root(*_a: Any, **_k: Any) -> ResolvedRemoteWorkspace:
        return ResolvedRemoteWorkspace(workspace_id="ignored", repo_root_id="root-1")

    async def _materialize_at_ref(*_a: Any, **kwargs: Any) -> MaterializedRemoteWorkspaceAtRef:
        if calls is not None:
            calls.update(kwargs)
        return MaterializedRemoteWorkspaceAtRef(
            workspace_id="ah-exact",
            observed_head_sha=materialized_head,
            outcome="created",
        )

    monkeypatch.setattr(
        workspaces_service.repositories_store, "get_cloud_repo_environment", _get_repo_environment
    )
    monkeypatch.setattr(
        workspaces_service.repositories_store, "get_repo_environment_by_id", _get_repo_environment
    )
    monkeypatch.setattr(workspaces_service, "require_github_cloud_repo_authority", _authority)
    monkeypatch.setattr(workspaces_service, "get_repo_branches_for_credentials", _branches)
    monkeypatch.setattr(
        workspaces_service.materialization_service, "materialize_repo_environment", _materialize
    )
    monkeypatch.setattr(
        workspaces_service.cloud_sandboxes_service,
        "load_cloud_sandbox_runtime_access",
        _runtime_access,
    )
    monkeypatch.setattr(
        workspaces_service.cloud_sandboxes_service,
        "require_cloud_provisioning_configured",
        lambda: None,
    )
    monkeypatch.setattr(workspaces_service, "_resolve_repo_root", _resolve_root)
    monkeypatch.setattr(workspaces_service, "materialize_workspace_at_ref", _materialize_at_ref)


@pytest.mark.asyncio
async def test_exact_ref_create_materializes_at_head_and_records_local_source(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from proliferate.db.store import cloud_workspace_materializations as store
    from proliferate.server.cloud.workspaces.models import (
        CreateCloudWorkspaceSourceMaterialization,
    )

    seed = await _seed(db_session)
    ws = await db_session.get(CloudWorkspace, seed.workspace.id)
    assert ws is not None
    await db_session.delete(ws)
    await db_session.flush()

    calls: dict[str, Any] = {}
    _patch_exact_ref_create(
        monkeypatch,
        seed,
        branch_heads={_BRANCH: _HEAD},
        materialized_head=_HEAD,
        calls=calls,
    )

    detail = await workspaces_service.create_cloud_workspace_for_user(
        db_session,
        SimpleNamespace(id=seed.user.id),
        CreateCloudWorkspaceRequest(
            gitOwner="acme",
            gitRepoName="widgets",
            branchName=_BRANCH,
            baseBranch="main",
            expectedHeadSha=_HEAD,
            sourceMaterialization=CreateCloudWorkspaceSourceMaterialization(
                targetKind="local_desktop",
                desktopInstallId=_INSTALL,
                anyharnessWorkspaceId="ws-local",
                worktreePath="/local/wt",
                observedHeadSha=_HEAD,
            ),
        ),
    )

    # AnyHarness was asked to materialize at the exact branch + commit.
    assert calls["branch_name"] == _BRANCH
    assert calls["head_sha"] == _HEAD
    assert detail.anyharness_workspace_id == "ah-exact"

    active = await store.list_active_materializations_for_workspace(
        db_session, cloud_workspace_id=uuid.UUID(detail.id)
    )
    managed = [m for m in active if m.target_kind == "managed_cloud"]
    locals_ = [m for m in active if m.target_kind == "local_desktop"]
    assert len(managed) == 1
    assert managed[0].expected_head_sha == _HEAD
    assert managed[0].observed_head_sha == _HEAD
    # The local source association was recorded as already hydrated.
    assert len(locals_) == 1
    assert locals_[0].desktop_install_id == _INSTALL
    assert locals_[0].state == "hydrated"
    assert locals_[0].anyharness_workspace_id == "ws-local"


@pytest.mark.asyncio
async def test_exact_ref_create_rejects_head_not_published(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    seed = await _seed(db_session)
    ws = await db_session.get(CloudWorkspace, seed.workspace.id)
    assert ws is not None
    await db_session.delete(ws)
    await db_session.flush()

    # GitHub's head for the branch differs from the client's expected head:
    # the local workspace has unpublished commits. Must fail-closed.
    _patch_exact_ref_create(
        monkeypatch,
        seed,
        branch_heads={_BRANCH: "different-sha"},
        materialized_head=_HEAD,
    )

    with pytest.raises(CloudApiError) as excinfo:
        await workspaces_service.create_cloud_workspace_for_user(
            db_session,
            SimpleNamespace(id=seed.user.id),
            CreateCloudWorkspaceRequest(
                gitOwner="acme",
                gitRepoName="widgets",
                branchName=_BRANCH,
                baseBranch="main",
                expectedHeadSha=_HEAD,
            ),
        )
    assert excinfo.value.code == "materialization_source_blocked"


@pytest.mark.asyncio
async def test_reconciliation_uses_recorded_sandbox_not_current(
    db_session: AsyncSession,
) -> None:
    """PR4-TARGET-03: a managed row is reconciled against its RECORDED sandbox.

    After the recorded sandbox S1 is destroyed and a replacement S2 exists and is
    live, the S1-scoped managed materialization must present as ``missing`` — it
    must not appear hydrated just because the owner now has a live S2.
    """
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)

    # Destroy the recorded sandbox S1.
    seed.sandbox.status = "destroyed"
    seed.sandbox.destroyed_at = datetime.now(UTC)
    await db_session.flush()

    # A brand-new replacement sandbox S2 for the same owner, live.
    s2 = CloudSandbox(
        id=uuid.uuid4(),
        owner_user_id=seed.user.id,
        sandbox_type="e2b",
        status="ready",
    )
    db_session.add(s2)
    await db_session.flush()

    detail = await workspaces_service.get_cloud_workspace_detail(
        db_session, seed.user.id, seed.workspace.id
    )
    managed = next(m for m in detail.materializations if m.target_kind == "managed_cloud")
    # Recorded sandbox is destroyed -> missing, regardless of the live S2.
    assert managed.state == "missing"


@pytest.mark.asyncio
async def test_intent_rejected_when_recorded_sandbox_destroyed_never_queries_replacement(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PR4-TARGET-03: intent preflight resolves the recorded sandbox only.

    When the managed row's recorded sandbox S1 is destroyed, the source read
    fails closed and the replacement sandbox S2 is never queried with S1's
    AnyHarness workspace id.
    """
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())

    # Spy: git-status must never be called for a destroyed recorded sandbox.
    called = {"count": 0}

    async def _never(*_a: Any, **_k: Any) -> RemoteGitStatusSnapshot:
        called["count"] += 1
        return _snapshot()

    monkeypatch.setattr(materializations_service, "get_runtime_git_status", _never)

    # Destroy S1, add live replacement S2.
    seed.sandbox.status = "destroyed"
    seed.sandbox.destroyed_at = datetime.now(UTC)
    await db_session.flush()
    db_session.add(
        CloudSandbox(
            id=uuid.uuid4(),
            owner_user_id=seed.user.id,
            sandbox_type="e2b",
            status="ready",
        )
    )
    await db_session.flush()

    with pytest.raises(CloudApiError) as excinfo:
        await _intent(db_session, seed)
    assert excinfo.value.code == "materialization_source_unavailable"
    assert called["count"] == 0


@pytest.mark.asyncio
async def test_repo_less_workspace_reads_and_rejects_intent(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PR4-BASE-02: a repo-less workspace (null repo identity) is read-robust.

    This branch's schema enforces NOT NULL on ``cloud_workspace.repo_environment_id``,
    so a repo-less row cannot be persisted here; #1245 (scratch) makes it
    nullable. We simulate the post-merge value by having the store yield a
    workspace with ``repo_environment_id=None`` and assert the read path emits
    null repo fields (no crash) and an intent is rejected cleanly.
    """
    from proliferate.db.store import cloud_workspaces as cloud_workspace_store

    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)

    real = await cloud_workspace_store.get_cloud_workspace_for_user(
        db_session, seed.user.id, seed.workspace.id
    )
    assert real is not None
    from dataclasses import replace as _replace

    repo_less = _replace(real, repo_environment_id=None)

    async def _repo_less_lookup(_db: Any, _user: Any, _ws: Any) -> Any:
        return repo_less

    monkeypatch.setattr(
        workspaces_service.cloud_workspace_store,
        "get_cloud_workspace_for_user",
        _repo_less_lookup,
    )
    monkeypatch.setattr(
        materializations_service.cloud_workspace_store,
        "get_cloud_workspace_for_user",
        _repo_less_lookup,
    )

    # Read path: repo/repoEnvironmentId are null, no crash; managed row present.
    detail = await workspaces_service.get_cloud_workspace_detail(
        db_session, seed.user.id, seed.workspace.id
    )
    assert detail.repo is None
    assert detail.repo_environment_id is None
    assert any(m.target_kind == "managed_cloud" for m in detail.materializations)

    # Intent path: cleanly rejected for a repo-less workspace.
    _patch_preflight(monkeypatch, snapshot=_snapshot())
    with pytest.raises(CloudApiError) as excinfo:
        await _intent(db_session, seed)
    assert excinfo.value.code == "materialization_source_unavailable"


@pytest.mark.asyncio
async def test_other_install_id_is_redacted(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """PR4-INSTALL-04: a non-matching local row's install id is not echoed.

    A caller (web/mobile, or a different install) sees presence/health for
    another device's local materialization but never its ``desktopInstallId``,
    worktree path, or AnyHarness id — so it cannot enumerate and re-submit other
    installs' ids to un-redact them.
    """
    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())
    intent = await _intent(db_session, seed)
    await materializations_service.report_materialization(
        db_session,
        user_id=seed.user.id,
        workspace_id=seed.workspace.id,
        materialization_id=uuid.UUID(intent.materialization.id),
        body=ReportMaterializationRequest(
            generation=intent.materialization.generation,
            state="hydrated",
            observedHeadSha=_HEAD,
            observedBranch=_BRANCH,
            worktreePath="/local/path",
            anyharnessWorkspaceId="ah-local",
        ),
    )

    # Web/Mobile view (no install): the local row's install id is redacted.
    without_install = await workspaces_service.get_cloud_workspace_detail(
        db_session, seed.user.id, seed.workspace.id
    )
    local = next(m for m in without_install.materializations if m.target_kind == "local_desktop")
    assert local.desktop_install_id is None
    assert local.worktree_path is None
    assert local.anyharness_workspace_id is None
    assert local.state == "hydrated"

    # Owning install still sees its own id.
    with_install = await workspaces_service.get_cloud_workspace_detail(
        db_session, seed.user.id, seed.workspace.id, desktop_install_id=_INSTALL
    )
    own = next(m for m in with_install.materializations if m.target_kind == "local_desktop")
    assert own.desktop_install_id == _INSTALL


@pytest.mark.asyncio
async def test_active_uniqueness_two_installs_and_workspaces(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    from proliferate.db.store import cloud_workspace_materializations as store

    seed = await _seed(db_session)
    await _seed_managed_materialization(db_session, seed)
    _patch_preflight(monkeypatch, snapshot=_snapshot())

    # Register a second desktop install for the same user.
    now = datetime.now(UTC)
    db_session.add(
        CloudRuntimeWorker(
            id=uuid.uuid4(),
            owner_user_id=seed.user.id,
            runtime_kind="desktop",
            desktop_install_id="mac-b",
            token_hash=uuid.uuid4().hex,
            status="online",
            enrolled_at=now,
            last_seen_at=now,
        )
    )
    await db_session.flush()

    await _intent(db_session, seed, body_install=_INSTALL)
    await _intent(db_session, seed, body_install="mac-b")

    active = await store.list_active_materializations_for_workspace(
        db_session, cloud_workspace_id=seed.workspace.id
    )
    # One managed + two locals (one per install).
    assert sum(1 for m in active if m.target_kind == "managed_cloud") == 1
    assert sorted(m.desktop_install_id for m in active if m.target_kind == "local_desktop") == [
        "mac-a",
        "mac-b",
    ]
