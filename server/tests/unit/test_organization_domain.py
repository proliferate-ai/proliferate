from __future__ import annotations

from uuid import uuid4

from proliferate.auth.authorization import OwnerContext, PolicyAllowed, PolicyDenied
from proliferate.constants.organizations import ORGANIZATION_NAME_MAX_LENGTH
from proliferate.server.organizations.domain.policy import (
    can_modify_membership,
    can_modify_owner_memberships,
    is_membership_update_status,
    is_organization_role,
    organization_admin_roles,
    required_roles_for_invitation_role,
)
from proliferate.server.organizations.domain.profile import (
    default_organization_name,
    derive_logo_domain_from_email,
    organization_name_issue,
    sanitize_logo_image,
)


def _owner_context(
    *,
    membership_id=None,
    role: str | None = "owner",
) -> OwnerContext:
    return OwnerContext(
        owner_scope="organization",
        actor_user_id=uuid4(),
        owner_user_id=None,
        organization_id=uuid4(),
        membership_id=membership_id or uuid4(),
        membership_role=role,
        billing_subject_id=uuid4(),
    )


def test_organization_profile_derives_business_logo_domain() -> None:
    assert derive_logo_domain_from_email("Founder@Acme-Tools.com") == "acme-tools.com"
    assert derive_logo_domain_from_email("person@gmail.com") is None


def test_default_organization_name_prefers_business_domain() -> None:
    assert default_organization_name(email="founder@acme-tools.com", display_name="Founder") == (
        "Acme Tools"
    )


def test_default_organization_name_falls_back_to_display_name() -> None:
    assert default_organization_name(email="person@gmail.com", display_name="Pablo") == (
        "Pablo's organization"
    )


def test_organization_name_validation_reports_empty_and_long_names() -> None:
    empty = organization_name_issue("  ")
    assert empty is not None
    assert empty.code == "invalid_organization_name"

    too_long = organization_name_issue("a" * (ORGANIZATION_NAME_MAX_LENGTH + 1))
    assert too_long is not None
    assert too_long.code == "invalid_organization_name"
    assert str(ORGANIZATION_NAME_MAX_LENGTH) in too_long.message


def test_logo_image_sanitization_reports_invalid_uploads() -> None:
    missing_data_url = sanitize_logo_image("not-a-data-url")
    assert missing_data_url.issue is not None
    assert missing_data_url.issue.code == "invalid_organization_logo_image"

    unsupported_mime = sanitize_logo_image("data:image/svg+xml;base64,PHN2Zy8+")
    assert unsupported_mime.issue is not None
    assert unsupported_mime.issue.message == "Organization image must be PNG, JPEG, WebP, or GIF."


def test_organization_policy_rejects_self_membership_mutation() -> None:
    membership_id = uuid4()
    verdict = can_modify_membership(_owner_context(membership_id=membership_id), membership_id)

    assert isinstance(verdict, PolicyDenied)
    assert verdict.code == "cannot_modify_own_membership"
    assert verdict.status_code == 403


def test_organization_policy_allows_other_membership_mutation() -> None:
    verdict = can_modify_membership(_owner_context(), uuid4())

    assert isinstance(verdict, PolicyAllowed)


def test_owner_policy_and_role_sets() -> None:
    assert can_modify_owner_memberships(_owner_context(role="owner")) is True
    assert can_modify_owner_memberships(_owner_context(role="admin")) is False
    assert required_roles_for_invitation_role("owner") == frozenset({"owner"})
    assert required_roles_for_invitation_role("member") == organization_admin_roles()


def test_membership_validation_helpers() -> None:
    assert is_organization_role("owner") is True
    assert is_organization_role("nonsense") is False
    assert is_membership_update_status("active") is True
    assert is_membership_update_status("pending") is False
