from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import cast
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.db.store.organization_records import (
    InvitationAcceptRecord,
    MembershipRecord,
    OrganizationRecord,
    OrganizationWithMembershipRecord,
)
from proliferate.server.organizations import service as organization_service
from proliferate.server.organizations.errors import OrganizationServiceError


def _accepted_record(
    *,
    organization_id: UUID,
    membership_id: UUID,
    user_id: UUID,
) -> InvitationAcceptRecord:
    now = datetime.now(UTC)
    return InvitationAcceptRecord(
        organization=OrganizationRecord(
            id=organization_id,
            name="Acme",
            slug="acme",
            logo_domain=None,
            logo_image=None,
            status="active",
            is_instance=False,
            created_at=now,
            updated_at=now,
        ),
        membership=MembershipRecord(
            id=membership_id,
            organization_id=organization_id,
            user_id=user_id,
            role="member",
            status="active",
            joined_at=now,
            removed_at=None,
        ),
    )


@pytest.mark.asyncio
async def test_try_accept_invitation_runs_owner_followups(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = cast(AsyncSession, object())
    organization_id = uuid4()
    user_id = uuid4()
    membership_id = uuid4()
    actor_user = SimpleNamespace(
        id=user_id,
        email="old-person@example.com",
        display_name="Person Example",
    )
    authenticated_email = "New-Person@Example.com"
    accepted = _accepted_record(
        organization_id=organization_id,
        membership_id=membership_id,
        user_id=user_id,
    )
    events: list[str] = []

    async def fake_accept_pending_invitation(
        call_db: AsyncSession,
        *,
        organization_id: UUID,
        authenticated_user_id: UUID,
        authenticated_email: str,
    ) -> tuple[InvitationAcceptRecord, None]:
        assert call_db is db
        assert organization_id == accepted.organization.id
        assert authenticated_user_id == actor_user.id
        assert authenticated_email == expected_authenticated_email
        events.append("accept")
        return accepted, None

    async def fake_maybe_create_organization_seat_adjustment(
        call_db: AsyncSession,
        *,
        organization_id: UUID,
        membership_id: UUID,
    ) -> None:
        assert call_db is db
        assert organization_id == accepted.organization.id
        assert membership_id == accepted.membership.id
        events.append("seat")

    def fake_schedule_agent_gateway_org_enrollment(
        scheduled_organization_id: UUID,
        scheduled_user_id: UUID,
        *,
        db: AsyncSession,
    ) -> None:
        assert scheduled_organization_id == accepted.organization.id
        assert scheduled_user_id == actor_user.id
        assert db is expected_db
        events.append("enrollment")

    expected_db = db
    expected_authenticated_email = authenticated_email
    monkeypatch.setattr(
        organization_service.invitation_store,
        "accept_pending_invitation_for_organization_email",
        fake_accept_pending_invitation,
    )
    monkeypatch.setattr(
        organization_service,
        "maybe_create_organization_seat_adjustment",
        fake_maybe_create_organization_seat_adjustment,
    )
    monkeypatch.setattr(
        organization_service,
        "schedule_agent_gateway_org_enrollment",
        fake_schedule_agent_gateway_org_enrollment,
    )

    result = await organization_service.try_accept_invitation(
        db,
        actor_user,
        organization_id=organization_id,
        authenticated_email=authenticated_email,
    )

    assert result == OrganizationWithMembershipRecord(
        organization=accepted.organization,
        membership=accepted.membership,
    )
    assert events == ["accept", "seat", "enrollment"]


@pytest.mark.asyncio
async def test_try_accept_invitation_returns_none_without_followups(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = cast(AsyncSession, object())
    organization_id = uuid4()
    user_id = uuid4()
    actor_user = SimpleNamespace(id=user_id, email="person@example.com", display_name=None)
    authenticated_email = "verified-person@example.com"
    store_calls = 0

    async def fake_accept_pending_invitation(
        call_db: AsyncSession,
        *,
        organization_id: UUID,
        authenticated_user_id: UUID,
        authenticated_email: str,
    ) -> tuple[None, str]:
        nonlocal store_calls
        assert call_db is db
        assert organization_id == expected_organization_id
        assert authenticated_user_id == actor_user.id
        assert authenticated_email == expected_authenticated_email
        store_calls += 1
        return None, "invalid_invitation"

    async def fail_seat_adjustment(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("seat adjustment must not run after rejection")

    def fail_enrollment(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("enrollment must not run after rejection")

    expected_organization_id = organization_id
    expected_authenticated_email = authenticated_email
    monkeypatch.setattr(
        organization_service.invitation_store,
        "accept_pending_invitation_for_organization_email",
        fake_accept_pending_invitation,
    )
    monkeypatch.setattr(
        organization_service,
        "maybe_create_organization_seat_adjustment",
        fail_seat_adjustment,
    )
    monkeypatch.setattr(
        organization_service,
        "schedule_agent_gateway_org_enrollment",
        fail_enrollment,
    )

    result = await organization_service.try_accept_invitation(
        db,
        actor_user,
        organization_id=organization_id,
        authenticated_email=authenticated_email,
    )

    assert result is None
    assert store_calls == 1


@pytest.mark.asyncio
async def test_accept_invitation_translates_store_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = cast(AsyncSession, object())
    organization_id = uuid4()
    actor_user = SimpleNamespace(
        id=uuid4(),
        email="person@example.com",
        display_name=None,
    )

    async def fake_accept_pending_invitation(
        *_args: object,
        **_kwargs: object,
    ) -> tuple[None, str]:
        return None, "invitation_email_mismatch"

    monkeypatch.setattr(
        organization_service.invitation_store,
        "accept_pending_invitation_for_organization_email",
        fake_accept_pending_invitation,
    )

    with pytest.raises(OrganizationServiceError) as exc_info:
        await organization_service.accept_invitation(
            db,
            actor_user,
            organization_id=organization_id,
        )

    assert exc_info.value.code == "invitation_email_mismatch"
    assert exc_info.value.status_code == 403
    assert exc_info.value.message == "This invitation was sent to a different email address."


@pytest.mark.asyncio
async def test_accept_invitation_uses_shared_owner_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = cast(AsyncSession, object())
    organization_id = uuid4()
    user_id = uuid4()
    actor_user = SimpleNamespace(id=user_id, email="person@example.com", display_name=None)
    accepted = _accepted_record(
        organization_id=organization_id,
        membership_id=uuid4(),
        user_id=user_id,
    )
    expected = OrganizationWithMembershipRecord(
        organization=accepted.organization,
        membership=accepted.membership,
    )
    calls = 0

    async def fake_shared_owner_path(
        call_db: AsyncSession,
        call_actor_user: object,
        *,
        organization_id: UUID,
        authenticated_email: str,
    ) -> tuple[OrganizationWithMembershipRecord, None]:
        nonlocal calls
        assert call_db is db
        assert call_actor_user is actor_user
        assert organization_id == expected.organization.id
        assert authenticated_email == actor_user.email
        calls += 1
        return expected, None

    monkeypatch.setattr(
        organization_service,
        "_accept_invitation_for_organization",
        fake_shared_owner_path,
    )

    result = await organization_service.accept_invitation(
        db,
        actor_user,
        organization_id=organization_id,
    )

    assert result is expected
    assert calls == 1


