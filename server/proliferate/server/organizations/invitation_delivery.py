"""Durable organization invitation delivery orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlencode
from uuid import UUID

from proliferate.config import settings
from proliferate.db import engine as db_engine
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store.organization_records import InvitationRecord
from proliferate.integrations import resend


@dataclass(frozen=True)
class DurableInvitationEmailResult:
    invitation: InvitationRecord
    delivery_attempted: bool


def _invitation_landing_url(token: str) -> str:
    path = "/v1/organizations/invitations/landing"
    query = urlencode({"token": token})
    base_url = (settings.api_base_url or settings.frontend_base_url).rstrip("/")
    if not base_url:
        return f"{path}?{query}"
    return f"{base_url}{path}?{query}"


async def _mark_delivery(
    *,
    invitation_id: UUID,
    fallback: InvitationRecord,
    sent: bool,
    skipped: bool,
    error: str | None = None,
) -> InvitationRecord:
    async with db_engine.async_session_factory() as db, db.begin():
        return (
            await invitation_store.mark_invitation_delivery(
                db,
                invitation_id=invitation_id,
                sent=sent,
                skipped=skipped,
                error=error,
            )
            or fallback
        )


async def _send_durable_invitation_email(
    *,
    invitation: InvitationRecord,
    organization_name: str,
    inviter_email: str,
    token: str,
) -> DurableInvitationEmailResult:
    try:
        result = await resend.send_organization_invitation_email(
            to_email=invitation.email,
            organization_name=organization_name,
            inviter_email=inviter_email,
            invite_url=_invitation_landing_url(token),
        )
    except resend.ResendEmailError as error:
        updated = await _mark_delivery(
            invitation_id=invitation.id,
            fallback=invitation,
            sent=False,
            skipped=False,
            error=error.message,
        )
        return DurableInvitationEmailResult(
            invitation=updated,
            delivery_attempted=False,
        )
    updated = await _mark_delivery(
        invitation_id=invitation.id,
        fallback=invitation,
        sent=not result.skipped,
        skipped=result.skipped,
    )
    return DurableInvitationEmailResult(
        invitation=updated,
        delivery_attempted=not result.skipped,
    )


async def create_and_send_invitation(
    *,
    organization_id: UUID,
    email: str,
    role: str,
    token_hash: str,
    invited_by_user_id: UUID,
    expires_at: datetime,
    token: str,
    inviter_email: str,
) -> DurableInvitationEmailResult | None:
    async with db_engine.async_session_factory() as db, db.begin():
        record = await invitation_store.create_or_rotate_organization_invitation(
            db,
            organization_id=organization_id,
            email=email,
            role=role,
            token_hash=token_hash,
            invited_by_user_id=invited_by_user_id,
            expires_at=expires_at,
        )
    if record is None:
        return None
    return await _send_durable_invitation_email(
        invitation=record.invitation,
        organization_name=record.organization.name,
        inviter_email=inviter_email,
        token=token,
    )


async def rotate_and_send_invitation(
    *,
    organization_id: UUID,
    invitation_id: UUID,
    token_hash: str,
    expires_at: datetime,
    token: str,
    inviter_email: str,
) -> DurableInvitationEmailResult | None:
    async with db_engine.async_session_factory() as db, db.begin():
        record = await invitation_store.rotate_organization_invitation(
            db,
            organization_id=organization_id,
            invitation_id=invitation_id,
            token_hash=token_hash,
            expires_at=expires_at,
        )
    if record is None:
        return None
    return await _send_durable_invitation_email(
        invitation=record.invitation,
        organization_name=record.organization.name,
        inviter_email=inviter_email,
        token=token,
    )
