from __future__ import annotations

from uuid import uuid4

from proliferate.auth.authorization import PolicyAllowed, PolicyDenied
from proliferate.server.cloud.claims.domain.policy import (
    can_archive_cloud_workspace,
    can_claim_cloud_workspace,
    can_interact_cloud_workspace,
    can_request_direct_attach_token,
    can_view_cloud_workspace,
)


def test_can_read_personal_cloud_workspace_for_owner() -> None:
    user_id = uuid4()

    verdict = can_view_cloud_workspace(
        actor_user_id=user_id,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        exposure_visibility=None,
        exposure_claimed_by_user_id=None,
        has_active_organization_membership=False,
        is_organization_admin=False,
    )

    assert isinstance(verdict, PolicyAllowed)


def test_can_read_personal_cloud_workspace_hides_non_owner() -> None:
    verdict = can_view_cloud_workspace(
        actor_user_id=uuid4(),
        owner_scope="personal",
        owner_user_id=uuid4(),
        organization_id=None,
        exposure_visibility=None,
        exposure_claimed_by_user_id=None,
        has_active_organization_membership=False,
        is_organization_admin=False,
    )

    assert isinstance(verdict, PolicyDenied)
    assert verdict.code == "workspace_not_found"
    assert verdict.status_code == 404


def test_can_view_shared_unclaimed_workspace_for_org_member() -> None:
    verdict = can_view_cloud_workspace(
        actor_user_id=uuid4(),
        owner_scope="organization",
        owner_user_id=None,
        organization_id=uuid4(),
        exposure_visibility="shared_unclaimed",
        exposure_claimed_by_user_id=None,
        has_active_organization_membership=True,
        is_organization_admin=False,
    )

    assert isinstance(verdict, PolicyAllowed)


def test_claimed_workspace_view_is_claimer_or_admin_only() -> None:
    claimer_id = uuid4()
    nonclaimer_id = uuid4()

    claimer_view = can_view_cloud_workspace(
        actor_user_id=claimer_id,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=uuid4(),
        exposure_visibility="claimed",
        exposure_claimed_by_user_id=claimer_id,
        has_active_organization_membership=True,
        is_organization_admin=False,
    )
    admin_audit_view = can_view_cloud_workspace(
        actor_user_id=nonclaimer_id,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=uuid4(),
        exposure_visibility="claimed",
        exposure_claimed_by_user_id=claimer_id,
        has_active_organization_membership=True,
        is_organization_admin=True,
    )
    nonclaimer_view = can_view_cloud_workspace(
        actor_user_id=nonclaimer_id,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=uuid4(),
        exposure_visibility="claimed",
        exposure_claimed_by_user_id=claimer_id,
        has_active_organization_membership=True,
        is_organization_admin=False,
    )

    assert isinstance(claimer_view, PolicyAllowed)
    assert isinstance(admin_audit_view, PolicyAllowed)
    assert isinstance(nonclaimer_view, PolicyDenied)
    assert nonclaimer_view.code == "workspace_not_found"


def test_claimed_workspace_interaction_is_claimer_only() -> None:
    claimer_id = uuid4()
    nonclaimer_id = uuid4()

    claimer_interact = can_interact_cloud_workspace(
        actor_user_id=claimer_id,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=uuid4(),
        exposure_visibility="claimed",
        exposure_claimed_by_user_id=claimer_id,
        workspace_archived=False,
        has_active_organization_membership=True,
    )
    nonclaimer_interact = can_interact_cloud_workspace(
        actor_user_id=nonclaimer_id,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=uuid4(),
        exposure_visibility="claimed",
        exposure_claimed_by_user_id=claimer_id,
        workspace_archived=False,
        has_active_organization_membership=True,
    )

    assert isinstance(claimer_interact, PolicyAllowed)
    assert isinstance(nonclaimer_interact, PolicyDenied)
    assert nonclaimer_interact.code == "claim_held_by_other"
    assert nonclaimer_interact.status_code == 403


def test_archive_policy_allows_repeated_archive_for_owner() -> None:
    user_id = uuid4()

    verdict = can_archive_cloud_workspace(
        actor_user_id=user_id,
        owner_scope="personal",
        owner_user_id=user_id,
        organization_id=None,
        exposure_visibility=None,
        exposure_claimed_by_user_id=None,
        workspace_archived=True,
        has_active_organization_membership=False,
        is_organization_admin=False,
    )

    assert isinstance(verdict, PolicyAllowed)


def test_archive_policy_allows_repeated_archive_for_claim_owner() -> None:
    claimer_id = uuid4()

    verdict = can_archive_cloud_workspace(
        actor_user_id=claimer_id,
        owner_scope="organization",
        owner_user_id=None,
        organization_id=uuid4(),
        exposure_visibility="claimed",
        exposure_claimed_by_user_id=claimer_id,
        workspace_archived=True,
        has_active_organization_membership=True,
        is_organization_admin=False,
    )

    assert isinstance(verdict, PolicyAllowed)


def test_can_claim_requires_shared_unclaimed_membership_and_no_existing_claim() -> None:
    allowed = can_claim_cloud_workspace(
        owner_scope="organization",
        organization_id=uuid4(),
        exposure_visibility="shared_unclaimed",
        workspace_archived=False,
        has_active_organization_membership=True,
        claim_exists=False,
    )
    already_claimed = can_claim_cloud_workspace(
        owner_scope="organization",
        organization_id=uuid4(),
        exposure_visibility="shared_unclaimed",
        workspace_archived=False,
        has_active_organization_membership=True,
        claim_exists=True,
    )
    private_workspace = can_claim_cloud_workspace(
        owner_scope="organization",
        organization_id=uuid4(),
        exposure_visibility="private",
        workspace_archived=False,
        has_active_organization_membership=True,
        claim_exists=False,
    )

    assert isinstance(allowed, PolicyAllowed)
    assert isinstance(already_claimed, PolicyDenied)
    assert already_claimed.code == "claim_held_by_other"
    assert isinstance(private_workspace, PolicyDenied)
    assert private_workspace.code == "workspace_not_unclaimed"


def test_direct_attach_token_policy_requires_desktop_claimer_and_ready_target() -> None:
    claimer_id = uuid4()

    allowed = can_request_direct_attach_token(
        actor_user_id=claimer_id,
        claimed_by_user_id=claimer_id,
        target_kind="managed_cloud",
        has_anyharness_base_url=True,
        client_kind="desktop",
        workspace_archived=False,
        exposure_visibility="claimed",
        exposure_claimed_by_user_id=claimer_id,
    )
    web_client = can_request_direct_attach_token(
        actor_user_id=claimer_id,
        claimed_by_user_id=claimer_id,
        target_kind="managed_cloud",
        has_anyharness_base_url=True,
        client_kind="web",
        workspace_archived=False,
        exposure_visibility="claimed",
        exposure_claimed_by_user_id=claimer_id,
    )
    missing_runtime = can_request_direct_attach_token(
        actor_user_id=claimer_id,
        claimed_by_user_id=claimer_id,
        target_kind="managed_cloud",
        has_anyharness_base_url=False,
        client_kind="desktop",
        workspace_archived=False,
        exposure_visibility="claimed",
        exposure_claimed_by_user_id=claimer_id,
    )

    assert isinstance(allowed, PolicyAllowed)
    assert isinstance(web_client, PolicyDenied)
    assert web_client.code == "direct_attach_desktop_only"
    assert isinstance(missing_runtime, PolicyDenied)
    assert missing_runtime.code == "direct_attach_not_ready"
