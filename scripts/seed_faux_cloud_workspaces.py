#!/usr/bin/env python3
"""Seed faux cloud-visible workspaces for local UI development.

The seed data is intentionally control-plane-only. It writes workspace,
exposure, target, organization, and session-projection rows, but it does not
enqueue CloudCommand records, provision sandboxes, or create AnyHarness
workspaces.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import uuid
from datetime import timedelta
from pathlib import Path

from sqlalchemy import select

from faux_cloud_workspace_fixtures import (
    DEFAULT_PROFILE,
    SEED_NAMESPACE,
    SEED_TEMPLATE_VERSION,
    TARGET_FIXTURES,
    WORKSPACE_FIXTURES,
    TargetFixture,
    TargetKey,
    WorkspaceFixture,
    profile_database_url,
    now as current_time,
    timestamp as fixture_timestamp,
    workspace_status_detail as fixture_workspace_status_detail,
)

ROOT = Path(__file__).resolve().parents[1]
SERVER_DIR = ROOT / "server"


def _seed_uuid(kind: str, key: str) -> uuid.UUID:
    return uuid.uuid5(SEED_NAMESPACE, f"{kind}:{key}")


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--profile",
        default=DEFAULT_PROFILE,
        help="Local dev profile name used to derive DATABASE_URL when --database-url is absent.",
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="Explicit SQLAlchemy async DATABASE_URL.",
    )
    parser.add_argument(
        "--user-email",
        default=os.environ.get("PROLIFERATE_FAUX_SEED_USER_EMAIL"),
        help=(
            "Existing local user that should own and see the faux workspaces. "
            "When omitted, the latest active local user is used."
        ),
    )
    parser.add_argument(
        "--organization-name",
        default="Proliferate Faux Team",
        help="Organization name to create/use for shared faux workspaces.",
    )
    return parser.parse_args(argv)


async def _seed(args: argparse.Namespace) -> None:
    # Import after DATABASE_URL is set and server/ is on sys.path.
    from proliferate.db.engine import async_session_factory
    from proliferate.db.models.auth import User
    from proliferate.db.models.cloud.agent_auth import SandboxProfile
    from proliferate.db.models.cloud.claims import CloudWorkspaceClaim
    from proliferate.db.models.cloud.exposures import CloudWorkspaceExposure
    from proliferate.db.models.cloud.sync import CloudSessionProjection
    from proliferate.db.models.cloud.targets import CloudTarget
    from proliferate.db.models.cloud.workspaces import CloudWorkspace
    from proliferate.db.models.organizations import Organization, OrganizationMembership
    from proliferate.db.store.billing import (
        ensure_organization_billing_subject,
        ensure_personal_billing_subject,
    )
    from proliferate.db.store.cloud_sandbox_profiles import (
        ensure_organization_sandbox_profile,
        ensure_personal_sandbox_profile,
    )
    from proliferate.db.store.cloud_sync import events as events_store
    from proliferate.db.store.cloud_workspaces import normalized_repo_key

    async with async_session_factory() as db:
        async with db.begin():
            user = await _load_seed_user(db, User, args.user_email)
            personal_subject = await ensure_personal_billing_subject(db, user.id)
            organization = await _ensure_organization(db, Organization, args.organization_name)
            await _ensure_membership(db, OrganizationMembership, organization.id, user.id)
            organization_subject = await ensure_organization_billing_subject(db, organization.id)
            personal_profile = await ensure_personal_sandbox_profile(
                db,
                user_id=user.id,
                created_by_user_id=user.id,
            )
            organization_profile = await ensure_organization_sandbox_profile(
                db,
                organization_id=organization.id,
                created_by_user_id=user.id,
            )
            await _activate_profile(db, SandboxProfile, personal_profile.id)
            await _activate_profile(db, SandboxProfile, organization_profile.id)

            target_ids: dict[TargetKey, uuid.UUID] = {}
            for fixture in TARGET_FIXTURES:
                profile_id = (
                    personal_profile.id
                    if fixture.owner_scope == "personal"
                    else organization_profile.id
                )
                target_id = await _upsert_target(
                    db,
                    CloudTarget,
                    fixture=fixture,
                    user_id=user.id,
                    organization_id=organization.id,
                    sandbox_profile_id=profile_id,
                )
                target_ids[fixture.key] = target_id

            seeded_workspace_ids: list[uuid.UUID] = []
            for fixture in WORKSPACE_FIXTURES:
                workspace_id = await _upsert_workspace(
                    db,
                    CloudWorkspace,
                    fixture=fixture,
                    user_id=user.id,
                    organization_id=organization.id,
                    personal_billing_subject_id=personal_subject.id,
                    organization_billing_subject_id=organization_subject.id,
                    personal_sandbox_profile_id=personal_profile.id,
                    organization_sandbox_profile_id=organization_profile.id,
                    target_id=target_ids[fixture.target_key],
                    normalized_repo_key=normalized_repo_key,
                )
                exposure_id = await _upsert_exposure(
                    db,
                    CloudWorkspaceExposure,
                    fixture=fixture,
                    user_id=user.id,
                    organization_id=organization.id,
                    target_id=target_ids[fixture.target_key],
                    workspace_id=workspace_id,
                )
                session_id, projection_id = await _upsert_session(
                    db,
                    CloudSessionProjection,
                    events_store=events_store,
                    fixture=fixture,
                    target_id=target_ids[fixture.target_key],
                    workspace_id=workspace_id,
                    exposure_id=exposure_id,
                )
                await _upsert_claim(
                    db,
                    CloudWorkspaceClaim,
                    fixture=fixture,
                    user_id=user.id,
                    organization_id=organization.id,
                    target_id=target_ids[fixture.target_key],
                    workspace_id=workspace_id,
                    exposure_id=exposure_id,
                    projection_id=projection_id,
                    session_id=session_id,
                )
                await _upsert_transcript(
                    events_store=events_store,
                    db=db,
                    fixture=fixture,
                    target_id=target_ids[fixture.target_key],
                    workspace_id=workspace_id,
                    session_id=session_id,
                )
                seeded_workspace_ids.append(workspace_id)

    print(
        f"Seeded {len(seeded_workspace_ids)} faux cloud-visible workspaces "
        f"for {user.email} in profile {args.profile}."
    )
    print("Organization:", args.organization_name)
    print("Template marker:", SEED_TEMPLATE_VERSION)


async def _load_seed_user(db, User, email: str | None):
    if email:
        user = (
            await db.execute(
                select(User)
                .where(User.email == email)
                .order_by(User.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if user is None:
            raise RuntimeError(f"No local user found with email {email!r}.")
        if not user.is_active:
            raise RuntimeError(f"Seed user {email!r} is not active.")
        return user

    user = (
        await db.execute(
            select(User)
            .where(User.is_active.is_(True))
            .order_by(User.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if user is None:
        raise RuntimeError("No active local user found to own faux workspaces.")
    return user


async def _ensure_organization(db, Organization, name: str):
    organization_id = _seed_uuid("organization", name)
    organization = await db.get(Organization, organization_id)
    if organization is None:
        now = current_time()
        organization = Organization(
            id=organization_id,
            name=name,
            created_at=now,
            updated_at=now,
        )
        db.add(organization)
    else:
        organization.name = name
        organization.updated_at = current_time()
    return organization


async def _ensure_membership(db, OrganizationMembership, organization_id, user_id) -> None:
    membership_id = _seed_uuid("organization_membership", f"{organization_id}:{user_id}")
    membership = (
        await db.execute(
            select(OrganizationMembership)
            .where(OrganizationMembership.organization_id == organization_id)
            .where(OrganizationMembership.user_id == user_id)
        )
    ).scalar_one_or_none()
    now = current_time()
    if membership is None:
        db.add(
            OrganizationMembership(
                id=membership_id,
                organization_id=organization_id,
                user_id=user_id,
                role="owner",
                status="active",
                joined_at=now,
                created_at=now,
                updated_at=now,
            )
        )
    else:
        membership.role = "owner"
        membership.status = "active"
        membership.removed_at = None
        membership.updated_at = now


async def _activate_profile(db, SandboxProfile, sandbox_profile_id) -> None:
    profile = await db.get(SandboxProfile, sandbox_profile_id)
    if profile is None:
        raise RuntimeError(f"Sandbox profile disappeared: {sandbox_profile_id}")
    profile.status = "active"
    profile.updated_at = current_time()


async def _upsert_target(
    db,
    CloudTarget,
    *,
    fixture: TargetFixture,
    user_id,
    organization_id,
    sandbox_profile_id,
):
    target_id = _seed_uuid("target", fixture.key)
    target = await db.get(CloudTarget, target_id)
    now = current_time()
    owner_user_id = user_id if fixture.owner_scope == "personal" else None
    owner_organization_id = organization_id if fixture.owner_scope == "organization" else None
    if target is None:
        target = CloudTarget(
            id=target_id,
            display_name=fixture.display_name,
            kind=fixture.kind,
            status="online",
            owner_scope=fixture.owner_scope,
            owner_user_id=owner_user_id,
            organization_id=owner_organization_id,
            created_by_user_id=user_id,
            sandbox_profile_id=sandbox_profile_id,
            profile_target_role="none",
            default_workspace_root=fixture.workspace_root,
            update_channel="stable",
            update_generation=0,
            update_status="idle",
            created_at=now,
            updated_at=now,
        )
        db.add(target)
    else:
        target.display_name = fixture.display_name
        target.kind = fixture.kind
        target.status = "online"
        target.owner_scope = fixture.owner_scope
        target.owner_user_id = owner_user_id
        target.organization_id = owner_organization_id
        target.created_by_user_id = user_id
        target.sandbox_profile_id = sandbox_profile_id
        target.profile_target_role = "none"
        target.default_workspace_root = fixture.workspace_root
        target.update_channel = "stable"
        target.update_status = "idle"
        target.archived_at = None
        target.updated_at = now
    return target_id


async def _upsert_workspace(
    db,
    CloudWorkspace,
    *,
    fixture: WorkspaceFixture,
    user_id,
    organization_id,
    personal_billing_subject_id,
    organization_billing_subject_id,
    personal_sandbox_profile_id,
    organization_sandbox_profile_id,
    target_id,
    normalized_repo_key,
):
    workspace_id = _seed_uuid("workspace", fixture.slug)
    workspace = await db.get(CloudWorkspace, workspace_id)
    updated_at = fixture_timestamp(fixture.minutes_ago)
    owner_user_id = user_id if fixture.owner_scope == "personal" else None
    owner_organization_id = organization_id if fixture.owner_scope == "organization" else None
    billing_subject_id = (
        personal_billing_subject_id
        if fixture.owner_scope == "personal"
        else organization_billing_subject_id
    )
    sandbox_profile_id = (
        personal_sandbox_profile_id
        if fixture.owner_scope == "personal"
        else organization_sandbox_profile_id
    )
    values = {
        "user_id": user_id,
        "owner_scope": fixture.owner_scope,
        "owner_user_id": owner_user_id,
        "organization_id": owner_organization_id,
        "created_by_user_id": user_id,
        "billing_subject_id": billing_subject_id,
        "runtime_environment_id": None,
        "sandbox_profile_id": sandbox_profile_id,
        "target_id": target_id,
        "display_name": fixture.display_name,
        "git_provider": "github",
        "git_owner": fixture.git_owner,
        "git_repo_name": fixture.git_repo_name,
        "normalized_repo_key": normalized_repo_key(
            git_provider="github",
            git_owner=fixture.git_owner,
            git_repo_name=fixture.git_repo_name,
        ),
        "git_branch": fixture.git_branch,
        "git_base_branch": fixture.git_base_branch,
        "worktree_path": None,
        "origin": fixture.origin,
        "origin_json": json.dumps(fixture.origin_context, separators=(",", ":")),
        "status": fixture.workspace_status,
        "status_detail": fixture_workspace_status_detail(fixture),
        "last_error": fixture.last_error,
        "template_version": SEED_TEMPLATE_VERSION,
        "runtime_generation": 1,
        "active_sandbox_id": None,
        "runtime_url": None,
        "runtime_token_ciphertext": None,
        "anyharness_workspace_id": f"faux-ws-{fixture.slug}",
        "materialized_slot_generation": None,
        "required_runtime_config_sequence": None,
        "required_runtime_config_revision_id": None,
        "required_agent_auth_revision": None,
        "repo_env_vars_ciphertext": None,
        "repo_files_applied_version": 0,
        "repo_setup_applied_version": 0,
        "repo_post_ready_phase": "idle",
        "repo_post_ready_files_total": 0,
        "repo_post_ready_files_applied": 0,
        "repo_post_ready_apply_token": None,
        "repo_files_last_failed_path": None,
        "repo_files_last_error": None,
        "updated_at": updated_at,
        "ready_at": updated_at if fixture.workspace_status == "ready" else None,
        "stopped_at": None,
        "repo_files_applied_at": None,
        "repo_post_ready_started_at": None,
        "repo_post_ready_completed_at": None,
        "archive_requested_at": None,
        "archived_at": None,
        "cleanup_state": "none",
        "cleanup_last_error": None,
    }
    if workspace is None:
        workspace = CloudWorkspace(id=workspace_id, created_at=updated_at, **values)
        db.add(workspace)
    else:
        for key, value in values.items():
            setattr(workspace, key, value)
        workspace.created_at = min(workspace.created_at or updated_at, updated_at)
    return workspace_id


async def _upsert_exposure(
    db,
    CloudWorkspaceExposure,
    *,
    fixture: WorkspaceFixture,
    user_id,
    organization_id,
    target_id,
    workspace_id,
):
    exposure_id = _seed_uuid("workspace_exposure", fixture.slug)
    exposure = await db.get(CloudWorkspaceExposure, exposure_id)
    now = fixture_timestamp(fixture.minutes_ago)
    owner_user_id = user_id if fixture.owner_scope == "personal" else None
    owner_organization_id = organization_id if fixture.owner_scope == "organization" else None
    claimed_by_user_id = user_id if fixture.visibility == "claimed" else None
    values = {
        "target_id": target_id,
        "cloud_workspace_id": workspace_id,
        "anyharness_workspace_id": f"faux-ws-{fixture.slug}",
        "owner_scope": fixture.owner_scope,
        "owner_user_id": owner_user_id,
        "organization_id": owner_organization_id,
        "visibility": fixture.visibility,
        "claimed_by_user_id": claimed_by_user_id,
        "default_projection_level": "live",
        "commandable": True,
        "status": "active",
        "revision": 1,
        "last_projected_at": now if fixture.exposure_projected else None,
        "origin": fixture.origin,
        "updated_at": now,
        "archived_at": None,
    }
    if exposure is None:
        exposure = CloudWorkspaceExposure(id=exposure_id, created_at=now, **values)
        db.add(exposure)
    else:
        for key, value in values.items():
            setattr(exposure, key, value)
    return exposure_id


async def _upsert_session(
    db,
    CloudSessionProjection,
    *,
    events_store,
    fixture: WorkspaceFixture,
    target_id,
    workspace_id,
    exposure_id,
):
    session_id = f"faux-session-{fixture.slug}"
    workspace_ref = f"faux-ws-{fixture.slug}"
    occurred_at = fixture_timestamp(fixture.minutes_ago).isoformat()
    started_at = fixture_timestamp(fixture.minutes_ago + 18).isoformat()
    ended_at = occurred_at if fixture.session_status == "ended" else None
    await events_store.upsert_session_projection(
        db,
        target_id=target_id,
        cloud_workspace_id=workspace_id,
        workspace_id=workspace_ref,
        session_id=session_id,
        seq=3,
        occurred_at=occurred_at,
        status=fixture.session_status,
        phase=None,
        native_session_id=session_id,
        source_agent_kind=fixture.source_agent_kind,
        title=fixture.session_title,
        live_config_json=json.dumps(
            {
                "agentKind": fixture.source_agent_kind,
                "model": "faux-ui-model",
                "reasoningEffort": "medium",
            },
            separators=(",", ":"),
        ),
        started_at=started_at,
        ended_at=ended_at,
    )
    projection = (
        await db.execute(
            select(CloudSessionProjection)
            .where(CloudSessionProjection.target_id == target_id)
            .where(CloudSessionProjection.session_id == session_id)
        )
    ).scalar_one()
    projection.exposure_id = exposure_id
    projection.updated_at = fixture_timestamp(fixture.minutes_ago)
    return session_id, projection.id


async def _upsert_claim(
    db,
    CloudWorkspaceClaim,
    *,
    fixture: WorkspaceFixture,
    user_id,
    organization_id,
    target_id,
    workspace_id,
    exposure_id,
    projection_id,
    session_id,
) -> None:
    claim = (
        await db.execute(
            select(CloudWorkspaceClaim)
            .where(CloudWorkspaceClaim.cloud_workspace_id == workspace_id)
        )
    ).scalar_one_or_none()
    if fixture.visibility != "claimed":
        if claim is not None:
            await db.delete(claim)
        return
    now = fixture_timestamp(fixture.minutes_ago)
    source_kind = fixture.claim_source_kind or "manual"
    values = {
        "cloud_workspace_id": workspace_id,
        "exposure_id": exposure_id,
        "organization_id": organization_id,
        "target_id": target_id,
        "anyharness_workspace_id": f"faux-ws-{fixture.slug}",
        "cloud_session_id": projection_id,
        "anyharness_session_id": session_id,
        "claimed_by_user_id": user_id,
        "source_kind": source_kind,
        "claimed_at": now,
        "created_at": now,
    }
    if claim is None:
        db.add(CloudWorkspaceClaim(id=_seed_uuid("claim", fixture.slug), **values))
    else:
        for key, value in values.items():
            setattr(claim, key, value)


async def _upsert_transcript(
    *,
    events_store,
    db,
    fixture: WorkspaceFixture,
    target_id,
    workspace_id,
    session_id: str,
) -> None:
    workspace_ref = f"faux-ws-{fixture.slug}"
    base_time = fixture_timestamp(fixture.minutes_ago + 12)
    turn_id = f"turn-{fixture.slug}"
    items = (
        ("user", "prompt", "User prompt", fixture.prompt, 1, base_time),
        (
            "tool",
            "tool_call",
            "Read context",
            "read docs and inspect the relevant workspace flow",
            2,
            base_time + timedelta(minutes=4),
        ),
        (
            "assistant",
            "assistant_prose",
            "Agent update",
            fixture.response,
            3,
            fixture_timestamp(fixture.minutes_ago),
        ),
    )
    for item_key, kind, title, text, seq, occurred_at in items:
        await events_store.upsert_transcript_item(
            db,
            target_id=target_id,
            cloud_workspace_id=workspace_id,
            workspace_id=workspace_ref,
            session_id=session_id,
            item_id=f"{session_id}:{item_key}",
            turn_id=turn_id,
            seq=seq,
            occurred_at=occurred_at.isoformat(),
            kind=kind,
            status="completed",
            source_agent_kind=fixture.source_agent_kind if item_key != "user" else None,
            title=title,
            text=text,
            payload_json=None,
            completed=True,
        )


def main(argv: list[str] | None = None) -> None:
    args = _parse_args(argv)
    database_url = args.database_url or profile_database_url(args.profile)
    os.environ["DATABASE_URL"] = database_url
    sys.path.insert(0, str(SERVER_DIR))
    asyncio.run(_seed(args))


if __name__ == "__main__":
    main()
