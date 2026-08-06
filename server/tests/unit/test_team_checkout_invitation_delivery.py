from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from proliferate.db.store.organization_records import (
    InvitationCreateRecord,
    InvitationRecord,
    OrganizationRecord,
)
from proliferate.integrations import resend
from proliferate.server.organizations import invitation_delivery

NOW = datetime(2026, 8, 5, 12, 0, tzinfo=UTC)
LOGGER_NAME = "proliferate.billing.team_checkout.activation"


@pytest.fixture
def _capture_team_checkout_logs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(invitation_delivery.team_checkout_logger, "disabled", False)
    monkeypatch.setattr(invitation_delivery.team_checkout_logger, "propagate", True)


def _organization(organization_id: UUID) -> OrganizationRecord:
    return OrganizationRecord(
        id=organization_id,
        name="Activation Team",
        slug="activation-team",
        logo_domain="example.com",
        logo_image=None,
        status="active",
        is_instance=False,
        created_at=NOW,
        updated_at=NOW,
    )


def _invitation(
    *,
    organization_id: UUID,
    invited_by_user_id: UUID,
    email: str,
    expires_at: datetime,
) -> InvitationRecord:
    return InvitationRecord(
        id=uuid4(),
        organization_id=organization_id,
        organization_name="Activation Team",
        email=email,
        role="member",
        status="pending",
        delivery_status="pending",
        delivery_error=None,
        expires_at=expires_at,
        delivered_at=None,
        invited_by_user_id=invited_by_user_id,
        accepted_by_user_id=None,
        accepted_at=None,
        revoked_at=None,
        expired_at=None,
        created_at=NOW,
        updated_at=NOW,
    )


class _DeliveryHarness:
    def __init__(self, organization_id: UUID, invited_by_user_id: UUID) -> None:
        self.organization_id = organization_id
        self.invited_by_user_id = invited_by_user_id
        self.active_transactions = 0
        self.transaction_count = 0
        self.trace: list[tuple[str, object]] = []
        self.create_calls: list[dict[str, object]] = []
        self.provider_calls: list[dict[str, str]] = []
        self.mark_calls: list[dict[str, object]] = []
        self.join_calls: list[UUID] = []
        self.invitations: dict[str, InvitationRecord] = {}
        self.missing_emails: set[str] = set()
        self.create_errors: dict[str, Exception] = {}
        self.provider_results: dict[str, resend.ResendEmailResult | Exception] = {}

    @asynccontextmanager
    async def open_transaction(self) -> AsyncIterator[object]:
        self.transaction_count += 1
        transaction_id = self.transaction_count
        assert self.active_transactions == 0
        self.active_transactions += 1
        self.trace.append(("transaction_enter", transaction_id))
        try:
            yield SimpleNamespace(transaction_id=transaction_id)
        finally:
            self.trace.append(("transaction_exit", transaction_id))
            self.active_transactions -= 1

    async def create(self, db: object, **kwargs: object) -> InvitationCreateRecord | None:
        assert self.active_transactions == 1
        email = kwargs["email"]
        assert isinstance(email, str)
        transaction_id = db.transaction_id  # type: ignore[attr-defined]
        self.trace.append(("create", (email, transaction_id)))
        self.create_calls.append({"db": db, **kwargs})
        if error := self.create_errors.get(email):
            raise error
        if email in self.missing_emails:
            return None
        expires_at = kwargs["expires_at"]
        assert isinstance(expires_at, datetime)
        invitation = _invitation(
            organization_id=self.organization_id,
            invited_by_user_id=self.invited_by_user_id,
            email=email,
            expires_at=expires_at,
        )
        self.invitations[email] = invitation
        return InvitationCreateRecord(
            invitation=invitation,
            organization=_organization(self.organization_id),
        )

    async def send(self, **kwargs: str) -> resend.ResendEmailResult:
        assert self.active_transactions == 0
        email = kwargs["to_email"]
        self.trace.append(("provider", email))
        self.provider_calls.append(dict(kwargs))
        result = self.provider_results.get(email)
        if isinstance(result, Exception):
            raise result
        return result or resend.ResendEmailResult(provider_message_id="email-id")

    async def mark(self, db: object, **kwargs: object) -> InvitationRecord:
        assert self.active_transactions == 1
        invitation_id = kwargs["invitation_id"]
        invitation = next(
            invitation
            for invitation in self.invitations.values()
            if invitation.id == invitation_id
        )
        transaction_id = db.transaction_id  # type: ignore[attr-defined]
        self.trace.append(("mark", (invitation.email, transaction_id)))
        self.mark_calls.append({"db": db, **kwargs})
        return invitation

    def join_url(self, organization_id: UUID) -> str:
        self.join_calls.append(organization_id)
        return f"https://hosted.example/join/{organization_id}"

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            invitation_delivery.db_session,
            "open_async_transaction",
            self.open_transaction,
        )
        monkeypatch.setattr(
            invitation_delivery.invitation_store,
            "create_or_rotate_organization_invitation",
            self.create,
        )
        monkeypatch.setattr(
            invitation_delivery.invitation_store,
            "mark_invitation_delivery",
            self.mark,
        )
        monkeypatch.setattr(
            invitation_delivery.resend,
            "send_organization_invitation_email",
            self.send,
        )
        monkeypatch.setattr(invitation_delivery, "organization_join_url", self.join_url)
        monkeypatch.setattr(invitation_delivery, "utcnow", lambda: NOW)


@pytest.mark.parametrize("payload", [None, "", "{}", '"email@example.com"'])
@pytest.mark.asyncio
async def test_falsey_and_non_list_staged_invites_are_silent(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _capture_team_checkout_logs: None,
    payload: str | None,
) -> None:
    def _forbidden_transaction() -> None:
        raise AssertionError("ignored staged invite input must not open a transaction")

    monkeypatch.setattr(
        invitation_delivery.db_session,
        "open_async_transaction",
        _forbidden_transaction,
    )

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
        await invitation_delivery.send_staged_team_checkout_invitations(
            organization_id=uuid4(),
            organization_name="Activation Team",
            invited_by_user_id=uuid4(),
            inviter_email="owner@example.com",
            invite_emails_json=payload,
        )

    assert caplog.records == []


@pytest.mark.asyncio
async def test_invalid_staged_invite_json_logs_exact_warning(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _capture_team_checkout_logs: None,
) -> None:
    organization_id = uuid4()

    def _forbidden_transaction() -> None:
        raise AssertionError("invalid staged invite JSON must not open a transaction")

    monkeypatch.setattr(
        invitation_delivery.db_session,
        "open_async_transaction",
        _forbidden_transaction,
    )

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
        await invitation_delivery.send_staged_team_checkout_invitations(
            organization_id=organization_id,
            organization_name="Activation Team",
            invited_by_user_id=uuid4(),
            inviter_email="owner@example.com",
            invite_emails_json="{invalid",
        )

    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.name == LOGGER_NAME
    assert record.levelno == logging.WARNING
    assert record.getMessage() == (
        "Skipping staged team checkout invitations because invite JSON is invalid"
    )
    assert record.organization_id == str(organization_id)  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_staged_invites_are_normalized_serial_and_outside_transactions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    organization_id = uuid4()
    creator_id = uuid4()
    harness = _DeliveryHarness(organization_id, creator_id)
    harness.provider_results["b@example.com"] = resend.ResendEmailResult(
        provider_message_id=None,
        skipped=True,
    )
    harness.install(monkeypatch)
    monkeypatch.setattr(invitation_delivery.settings, "single_org_mode_override", True)

    await invitation_delivery.send_staged_team_checkout_invitations(
        organization_id=organization_id,
        organization_name="Activation Team",
        invited_by_user_id=creator_id,
        inviter_email="owner@example.com",
        invite_emails_json=(
            '[" B@example.com ", 7, "", "a@example.com", "b@example.com", "A@example.com"]'
        ),
    )

    assert [call["email"] for call in harness.create_calls] == [
        "a@example.com",
        "b@example.com",
    ]
    assert all(call["role"] == "member" for call in harness.create_calls)
    assert all(call["organization_id"] == organization_id for call in harness.create_calls)
    assert all(call["invited_by_user_id"] == creator_id for call in harness.create_calls)
    assert all(
        call["expires_at"]
        == NOW + timedelta(days=invitation_delivery.ORGANIZATION_INVITE_EXPIRES_DAYS)
        for call in harness.create_calls
    )
    assert [call["to_email"] for call in harness.provider_calls] == [
        "a@example.com",
        "b@example.com",
    ]
    assert [call["invite_url"] for call in harness.provider_calls] == [
        f"https://hosted.example/join/{organization_id}",
        f"https://hosted.example/join/{organization_id}",
    ]
    assert harness.join_calls == [organization_id, organization_id]
    assert [(call["sent"], call["skipped"], call.get("error")) for call in harness.mark_calls] == [
        (True, False, None),
        (False, True, None),
    ]
    create_transactions = [
        call["db"].transaction_id
        for call in harness.create_calls  # type: ignore[attr-defined]
    ]
    mark_transactions = [
        call["db"].transaction_id
        for call in harness.mark_calls  # type: ignore[attr-defined]
    ]
    assert create_transactions == [1, 3]
    assert mark_transactions == [2, 4]
    assert harness.trace == [
        ("transaction_enter", 1),
        ("create", ("a@example.com", 1)),
        ("transaction_exit", 1),
        ("provider", "a@example.com"),
        ("transaction_enter", 2),
        ("mark", ("a@example.com", 2)),
        ("transaction_exit", 2),
        ("transaction_enter", 3),
        ("create", ("b@example.com", 3)),
        ("transaction_exit", 3),
        ("provider", "b@example.com"),
        ("transaction_enter", 4),
        ("mark", ("b@example.com", 4)),
        ("transaction_exit", 4),
    ]
    assert harness.active_transactions == 0


@pytest.mark.asyncio
async def test_resend_failure_marks_failed_and_logs_exact_warning(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _capture_team_checkout_logs: None,
) -> None:
    organization_id = uuid4()
    creator_id = uuid4()
    harness = _DeliveryHarness(organization_id, creator_id)
    harness.provider_results["failed@example.com"] = resend.ResendEmailError(
        "resend_unavailable",
        "Resend is unavailable.",
    )
    harness.install(monkeypatch)

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
        await invitation_delivery.send_staged_team_checkout_invitations(
            organization_id=organization_id,
            organization_name="Activation Team",
            invited_by_user_id=creator_id,
            inviter_email="owner@example.com",
            invite_emails_json='["failed@example.com"]',
        )

    assert len(harness.mark_calls) == 1
    mark = harness.mark_calls[0]
    assert (mark["sent"], mark["skipped"], mark["error"]) == (
        False,
        False,
        "Resend is unavailable.",
    )
    assert mark["db"].transaction_id == 2  # type: ignore[attr-defined]
    assert len(caplog.records) == 1
    record = caplog.records[0]
    invitation = harness.invitations["failed@example.com"]
    assert record.name == LOGGER_NAME
    assert record.getMessage() == "Failed to deliver staged team checkout invitation"
    assert record.organization_id == str(organization_id)  # type: ignore[attr-defined]
    assert record.invitation_id == str(invitation.id)  # type: ignore[attr-defined]
    assert record.email == "failed@example.com"  # type: ignore[attr-defined]
    assert record.error_code == "resend_unavailable"  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_missing_organization_skips_provider_and_logs_exact_warning(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _capture_team_checkout_logs: None,
) -> None:
    organization_id = uuid4()
    creator_id = uuid4()
    harness = _DeliveryHarness(organization_id, creator_id)
    harness.missing_emails.add("missing@example.com")
    harness.install(monkeypatch)

    with caplog.at_level(logging.WARNING, logger=LOGGER_NAME):
        await invitation_delivery.send_staged_team_checkout_invitations(
            organization_id=organization_id,
            organization_name="Activation Team",
            invited_by_user_id=creator_id,
            inviter_email="owner@example.com",
            invite_emails_json='["missing@example.com"]',
        )

    assert harness.provider_calls == []
    assert harness.mark_calls == []
    assert harness.transaction_count == 1
    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.name == LOGGER_NAME
    assert record.getMessage() == (
        "Skipping staged team checkout invitation because organization was not found"
    )
    assert record.organization_id == str(organization_id)  # type: ignore[attr-defined]
    assert record.email == "missing@example.com"  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_unexpected_failure_logs_exception_and_continues(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _capture_team_checkout_logs: None,
) -> None:
    organization_id = uuid4()
    creator_id = uuid4()
    harness = _DeliveryHarness(organization_id, creator_id)
    harness.create_errors["a@example.com"] = RuntimeError("unexpected create failure")
    harness.install(monkeypatch)

    with caplog.at_level(logging.ERROR, logger=LOGGER_NAME):
        await invitation_delivery.send_staged_team_checkout_invitations(
            organization_id=organization_id,
            organization_name="Activation Team",
            invited_by_user_id=creator_id,
            inviter_email="owner@example.com",
            invite_emails_json='["b@example.com", "a@example.com"]',
        )

    assert [call["email"] for call in harness.create_calls] == [
        "a@example.com",
        "b@example.com",
    ]
    assert [call["to_email"] for call in harness.provider_calls] == ["b@example.com"]
    assert len(harness.mark_calls) == 1
    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.name == LOGGER_NAME
    assert record.getMessage() == (
        "Unexpected failure while creating staged team checkout invitation"
    )
    assert record.organization_id == str(organization_id)  # type: ignore[attr-defined]
    assert record.email == "a@example.com"  # type: ignore[attr-defined]
    assert record.exc_info is not None
    assert harness.active_transactions == 0
