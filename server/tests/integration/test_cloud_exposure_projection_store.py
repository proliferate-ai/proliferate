from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.models.auth import User
from proliferate.db.models.billing import BillingSubject
from proliferate.db.models.cloud.agent_auth import SandboxProfile
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.store.cloud_sync import events as events_store
from proliferate.db.store.cloud_sync import exposures as exposures_store
from proliferate.db.store.cloud_sync import projections as projections_store


async def _seed_managed_workspace(db: AsyncSession) -> tuple[User, CloudTarget, CloudWorkspace]:
    user = User(
        id=uuid.uuid4(),
        email=f"{uuid.uuid4()}@example.com",
        hashed_password="hashed",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )
    billing_subject = BillingSubject(
        id=uuid.uuid4(),
        kind="personal",
        user_id=user.id,
        organization_id=None,
    )
    profile = SandboxProfile(
        id=uuid.uuid4(),
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        billing_subject_id=billing_subject.id,
        created_by_user_id=user.id,
        desired_agent_auth_revision=0,
        status="active",
    )
    target = CloudTarget(
        id=uuid.uuid4(),
        display_name="Personal cloud",
        kind="managed_cloud",
        status="online",
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        sandbox_profile_id=profile.id,
        profile_target_role="primary",
    )
    workspace = CloudWorkspace(
        id=uuid.uuid4(),
        user_id=user.id,
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        created_by_user_id=user.id,
        billing_subject_id=billing_subject.id,
        sandbox_profile_id=profile.id,
        target_id=target.id,
        display_name="acme/rocket",
        git_provider="github",
        git_owner="acme",
        git_repo_name="rocket",
        normalized_repo_key="github/acme/rocket",
        git_branch="main",
        git_base_branch="main",
        origin="manual_web",
        origin_json='{"kind":"human","entrypoint":"cloud"}',
        status="ready",
        status_detail="Ready",
        template_version="v1",
        runtime_generation=0,
        repo_post_ready_phase="idle",
        repo_post_ready_files_total=0,
        repo_post_ready_files_applied=0,
        cleanup_state="none",
    )
    db.add_all([user, billing_subject, profile, target, workspace])
    await db.flush()
    return user, target, workspace


@pytest.mark.asyncio
async def test_workspace_exposure_upsert_and_archive(db_session: AsyncSession) -> None:
    user, target, workspace = await _seed_managed_workspace(db_session)

    created = await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id="workspace-1",
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        visibility="private",
        default_projection_level="live",
        commandable=True,
        origin="manual_web",
    )

    assert created.revision == 1
    assert created.status == "active"
    assert created.commandable is True

    updated = await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id="workspace-1",
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        visibility="private",
        default_projection_level="transcript",
        commandable=False,
        origin="manual_web",
    )

    assert updated.id == created.id
    assert updated.revision == 2
    assert updated.default_projection_level == "transcript"
    assert updated.commandable is False

    archived = await exposures_store.archive_workspace_exposure(
        db_session,
        exposure_id=created.id,
    )

    assert archived is not None
    assert archived.visibility == "archived"
    assert archived.status == "revoked"
    assert archived.commandable is False
    assert archived.archived_at is not None

    recreated = await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id="workspace-1",
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        visibility="private",
        default_projection_level="live",
        commandable=True,
        origin="manual_web",
    )

    assert recreated.id != created.id
    active = await exposures_store.get_active_workspace_exposure(
        db_session,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
    )
    assert active is not None
    assert active.id == recreated.id


@pytest.mark.asyncio
async def test_projection_metadata_gap_state_and_upload_cursor(
    db_session: AsyncSession,
) -> None:
    user, target, workspace = await _seed_managed_workspace(db_session)
    exposure = await exposures_store.upsert_workspace_exposure(
        db_session,
        target_id=target.id,
        cloud_workspace_id=workspace.id,
        anyharness_workspace_id="workspace-1",
        owner_scope="personal",
        owner_user_id=user.id,
        organization_id=None,
        visibility="private",
        default_projection_level="live",
        commandable=True,
        origin="manual_web",
    )

    projection = await projections_store.upsert_session_projection_metadata(
        db_session,
        target_id=target.id,
        session_id="session-1",
        exposure_id=exposure.id,
        cloud_workspace_id=workspace.id,
        workspace_id="workspace-1",
        projection_level="live",
        commandable=True,
        agent_run_config_snapshot_json={"agent": "codex"},
    )

    assert projection.exposure_id == exposure.id
    assert projection.last_uploaded_seq == 0
    assert projection.agent_run_config_snapshot_json == {"agent": "codex"}

    await events_store.upsert_ingest_cursor(
        db_session,
        target_id=target.id,
        session_id="session-1",
        worker_id=None,
        cloud_workspace_id=workspace.id,
        workspace_id="workspace-1",
        last_contiguous_seq=7,
    )
    uploaded = await projections_store.get_session_projection_metadata(
        db_session,
        target_id=target.id,
        session_id="session-1",
    )
    assert uploaded is not None
    assert uploaded.last_uploaded_seq == 7

    gapped = await projections_store.set_projection_gap_state(
        db_session,
        target_id=target.id,
        session_id="session-1",
        gap_state_json='{"lastGapSeq":8,"kind":"missing_seq"}',
    )
    assert gapped is not None
    assert gapped.gap_state_json == '{"lastGapSeq":8,"kind":"missing_seq"}'

    cleared = await projections_store.clear_projection_gap_state(
        db_session,
        target_id=target.id,
        session_id="session-1",
    )
    assert cleared is not None
    assert cleared.gap_state_json is None

    cursors = await projections_store.list_active_projection_cursors_for_target(
        db_session,
        target_id=target.id,
    )
    assert len(cursors) == 1
    assert cursors[0].last_uploaded_seq == 7
    assert cursors[0].anyharness_workspace_id == "workspace-1"

    await exposures_store.archive_workspace_exposure(db_session, exposure_id=exposure.id)

    assert (
        await projections_store.list_active_projection_cursors_for_target(
            db_session,
            target_id=target.id,
        )
        == ()
    )
