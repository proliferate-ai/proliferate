"""Team checkout Stripe activation flow."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
from datetime import timedelta
from urllib.parse import urlencode
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.config import settings
from proliferate.constants.organizations import (
    ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BILLING_STATE,
    ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BUSINESS_STATE,
    ORGANIZATION_CHECKOUT_INTENT_STATUS_PENDING,
    ORGANIZATION_INVITE_EXPIRES_DAYS,
    ORGANIZATION_INVITE_TOKEN_DOMAIN,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_STATUS_PENDING_CHECKOUT,
)
from proliferate.db import session_ops as db_session
from proliferate.db.models.billing import BillingSubscription
from proliferate.db.store import billing_subscriptions
from proliferate.db.store import organization_invitations as invitation_store
from proliferate.db.store import users as user_store
from proliferate.db.store.organizations import (
    acquire_membership_activation_lock,
    complete_team_checkout_activation,
    get_current_membership_for_user,
    load_team_checkout_intent_for_update,
    mark_team_checkout_activating,
    mark_team_checkout_failed,
)
from proliferate.integrations import resend
from proliferate.integrations import stripe as stripe_billing
from proliferate.server.billing.domain.pricing import (
    monthly_subscription_price_ids,
    overage_subscription_price_ids,
)
from proliferate.server.billing.domain.webhooks import (
    id_from_expandable as _stripe_id_from_expandable,
)
from proliferate.server.billing.domain.webhooks import metadata as _stripe_metadata
from proliferate.server.billing.domain.webhooks import (
    subscription_item_details as _stripe_subscription_item_details,
)
from proliferate.server.billing.domain.webhooks import (
    subscription_period as _stripe_subscription_period,
)
from proliferate.server.billing.models import BillingServiceError, coerce_utc, utcnow
from proliferate.server.billing.pricing import billing_price_ids_from_settings

logger = logging.getLogger("proliferate.billing.team_checkout.activation")


def _map_stripe_error(error: stripe_billing.StripeBillingError) -> BillingServiceError:
    return BillingServiceError(error.code, error.message, status_code=error.status_code)


def _organization_invite_token_hash(raw_token: str) -> str:
    return hmac.new(
        settings.cloud_secret_key.encode("utf-8"),
        f"{ORGANIZATION_INVITE_TOKEN_DOMAIN}:{raw_token}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _organization_invitation_landing_url(token: str) -> str:
    path = "/v1/organizations/invitations/landing"
    query = urlencode({"token": token})
    base_url = (settings.api_base_url or settings.frontend_base_url).rstrip("/")
    if not base_url:
        return f"{path}?{query}"
    return f"{base_url}{path}?{query}"


async def _send_staged_team_checkout_invitation(
    *,
    organization_id: UUID,
    organization_name: str,
    invited_by_user_id: UUID,
    inviter_email: str,
    email: str,
) -> None:
    token = secrets.token_urlsafe(32)
    async with db_session.open_async_transaction() as db:
        record = await invitation_store.create_or_rotate_organization_invitation(
            db,
            organization_id=organization_id,
            email=email,
            role=ORGANIZATION_ROLE_MEMBER,
            token_hash=_organization_invite_token_hash(token),
            invited_by_user_id=invited_by_user_id,
            expires_at=utcnow() + timedelta(days=ORGANIZATION_INVITE_EXPIRES_DAYS),
        )
    if record is None:
        logger.warning(
            "Skipping staged team checkout invitation because organization was not found",
            extra={"organization_id": str(organization_id), "email": email},
        )
        return
    try:
        result = await resend.send_organization_invitation_email(
            to_email=record.invitation.email,
            organization_name=organization_name,
            inviter_email=inviter_email,
            invite_url=_organization_invitation_landing_url(token),
        )
    except resend.ResendEmailError as error:
        async with db_session.open_async_transaction() as db:
            await invitation_store.mark_invitation_delivery(
                db,
                invitation_id=record.invitation.id,
                sent=False,
                skipped=False,
                error=error.message,
            )
        logger.warning(
            "Failed to deliver staged team checkout invitation",
            extra={
                "organization_id": str(organization_id),
                "invitation_id": str(record.invitation.id),
                "email": record.invitation.email,
                "error_code": error.code,
            },
        )
        return
    async with db_session.open_async_transaction() as db:
        await invitation_store.mark_invitation_delivery(
            db,
            invitation_id=record.invitation.id,
            sent=not result.skipped,
            skipped=result.skipped,
        )


async def _send_staged_team_checkout_invitations(
    *,
    organization_id: UUID,
    organization_name: str,
    invited_by_user_id: UUID,
    inviter_email: str,
    invite_emails_json: str | None,
) -> None:
    if not invite_emails_json:
        return
    try:
        raw_invites = json.loads(invite_emails_json)
    except ValueError:
        logger.warning(
            "Skipping staged team checkout invitations because invite JSON is invalid",
            extra={"organization_id": str(organization_id)},
        )
        return
    if not isinstance(raw_invites, list):
        return
    invite_emails = sorted(
        {
            email.strip().lower()
            for email in raw_invites
            if isinstance(email, str) and email.strip()
        }
    )
    for email in invite_emails:
        try:
            await _send_staged_team_checkout_invitation(
                organization_id=organization_id,
                organization_name=organization_name,
                invited_by_user_id=invited_by_user_id,
                inviter_email=inviter_email,
                email=email,
            )
        except Exception:
            logger.exception(
                "Unexpected failure while creating staged team checkout invitation",
                extra={"organization_id": str(organization_id), "email": email},
            )


async def _upsert_team_subscription_from_stripe(
    db: AsyncSession,
    *,
    subscription: dict,
    billing_subject_id: UUID,
) -> BillingSubscription:
    subscription_id = subscription.get("id")
    customer_id = _stripe_id_from_expandable(subscription.get("customer"))
    status = subscription.get("status")
    if not isinstance(subscription_id, str) or not isinstance(customer_id, str):
        raise BillingServiceError(
            "stripe_invalid_subscription",
            "Stripe subscription is missing an id or customer.",
            status_code=502,
        )
    if not isinstance(status, str):
        raise BillingServiceError(
            "stripe_invalid_subscription",
            "Stripe subscription is missing a status.",
            status_code=502,
        )
    details = _stripe_subscription_item_details(
        subscription,
        monthly_price_ids=monthly_subscription_price_ids(billing_price_ids_from_settings()),
        overage_price_ids=overage_subscription_price_ids(billing_price_ids_from_settings()),
    )
    current_period_start, current_period_end = _stripe_subscription_period(
        subscription,
        monthly_item_id=details.monthly_item_id,
        metered_item_id=details.metered_item_id,
    )
    return await billing_subscriptions.upsert_billing_subscription(
        db,
        billing_subject_id=billing_subject_id,
        stripe_subscription_id=subscription_id,
        stripe_customer_id=customer_id,
        status=status,
        cancel_at_period_end=bool(subscription.get("cancel_at_period_end")),
        canceled_at=coerce_utc(None),
        current_period_start=current_period_start,
        current_period_end=current_period_end,
        cloud_monthly_price_id=details.monthly_price_id,
        overage_price_id=details.overage_price_id,
        monthly_subscription_item_id=details.monthly_item_id,
        metered_subscription_item_id=details.metered_item_id,
        latest_invoice_id=_stripe_id_from_expandable(subscription.get("latest_invoice")),
        latest_invoice_status=None,
        hosted_invoice_url=None,
        seat_quantity=details.seat_quantity,
    )


async def activate_team_checkout_from_stripe_session(
    *,
    session: dict,
    webhook_event_id: str | None = None,
) -> None:
    metadata = _stripe_metadata(session)
    if metadata.get("purpose") != "team_subscription":
        return
    intent_id_value = metadata.get("organization_checkout_intent_id")
    organization_id_value = metadata.get("organization_id")
    created_by_user_id_value = metadata.get("created_by_user_id")
    billing_subject_id_value = metadata.get("billing_subject_id")
    if not (
        intent_id_value
        and organization_id_value
        and created_by_user_id_value
        and billing_subject_id_value
    ):
        raise BillingServiceError(
            "team_checkout_metadata_missing",
            "Team checkout metadata is incomplete.",
            status_code=400,
        )
    try:
        intent_id = UUID(intent_id_value)
        organization_id = UUID(organization_id_value)
        created_by_user_id = UUID(created_by_user_id_value)
        billing_subject_id = UUID(billing_subject_id_value)
    except ValueError as exc:
        raise BillingServiceError(
            "team_checkout_metadata_invalid",
            "Team checkout metadata is invalid.",
            status_code=400,
        ) from exc
    subscription_id = _stripe_id_from_expandable(session.get("subscription"))
    customer_id = _stripe_id_from_expandable(session.get("customer"))
    if subscription_id is None or customer_id is None:
        raise BillingServiceError(
            "team_checkout_subscription_missing",
            "Team checkout session is missing its subscription.",
            status_code=400,
        )
    try:
        subscription = await stripe_billing.retrieve_subscription(subscription_id)
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    subscription_metadata = _stripe_metadata(subscription)
    for key, expected in {
        "purpose": "team_subscription",
        "organization_checkout_intent_id": intent_id_value,
        "organization_id": organization_id_value,
        "created_by_user_id": created_by_user_id_value,
        "billing_subject_id": billing_subject_id_value,
    }.items():
        if subscription_metadata.get(key) != expected:
            raise BillingServiceError(
                "team_checkout_subscription_metadata_mismatch",
                "Team checkout subscription metadata does not match the checkout session.",
                status_code=409,
            )
    status = subscription.get("status")
    if status not in {"active", "trialing"}:
        async with db_session.open_async_transaction() as db:
            row = await load_team_checkout_intent_for_update(db, intent_id)
            if row is not None:
                intent, _organization = row
                await mark_team_checkout_failed(
                    db,
                    intent,
                    activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BILLING_STATE,
                    error_code="subscription_not_active",
                    error_message="Team subscription is not active or trialing.",
                    webhook_event_id=webhook_event_id,
                )
        return

    staged_invites: tuple[UUID, str, UUID, str, str | None] | None = None
    async with db_session.open_async_transaction() as db:
        row = await load_team_checkout_intent_for_update(db, intent_id)
        if row is None:
            raise BillingServiceError(
                "team_checkout_intent_not_found",
                "Team checkout intent was not found.",
                status_code=404,
            )
        intent, organization = row
        if (
            intent.organization_id != organization_id
            or intent.created_by_user_id != created_by_user_id
            or intent.billing_subject_id != billing_subject_id
            or organization.id != organization_id
        ):
            raise BillingServiceError(
                "team_checkout_intent_mismatch",
                "Team checkout intent does not match Stripe metadata.",
                status_code=409,
            )
        if intent.status != ORGANIZATION_CHECKOUT_INTENT_STATUS_PENDING:
            return
        if organization.status != ORGANIZATION_STATUS_PENDING_CHECKOUT:
            await mark_team_checkout_failed(
                db,
                intent,
                activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BUSINESS_STATE,
                error_code="organization_not_pending_checkout",
                error_message="Team checkout organization is not pending checkout.",
                webhook_event_id=webhook_event_id,
            )
            return
        creator = await user_store.get_user_by_id(db, created_by_user_id)
        if creator is None:
            await mark_team_checkout_failed(
                db,
                intent,
                activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BUSINESS_STATE,
                error_code="checkout_creator_not_found",
                error_message="Checkout creator account was not found.",
                webhook_event_id=webhook_event_id,
            )
            return
        await acquire_membership_activation_lock(db, created_by_user_id)
        current = await get_current_membership_for_user(db, created_by_user_id)
        if current is not None:
            await mark_team_checkout_failed(
                db,
                intent,
                activation_status=ORGANIZATION_CHECKOUT_ACTIVATION_FAILED_BUSINESS_STATE,
                error_code="creator_already_in_organization",
                error_message="Checkout creator already belongs to a team.",
                webhook_event_id=webhook_event_id,
            )
            return
        await mark_team_checkout_activating(db, intent, stripe_subscription_id=subscription_id)
        await _upsert_team_subscription_from_stripe(
            db,
            subscription=subscription,
            billing_subject_id=billing_subject_id,
        )
        activated = await complete_team_checkout_activation(
            db,
            intent=intent,
            organization=organization,
            stripe_subscription_id=subscription_id,
            stripe_customer_id=customer_id,
            webhook_event_id=webhook_event_id,
        )
        staged_invites = (
            activated.organization.id,
            activated.organization.name,
            created_by_user_id,
            creator.email,
            intent.invite_emails_json,
        )
    if staged_invites is not None:
        (
            activated_organization_id,
            activated_organization_name,
            activated_created_by_user_id,
            activated_creator_email,
            activated_invite_emails_json,
        ) = staged_invites
        await _send_staged_team_checkout_invitations(
            organization_id=activated_organization_id,
            organization_name=activated_organization_name,
            invited_by_user_id=activated_created_by_user_id,
            inviter_email=activated_creator_email,
            invite_emails_json=activated_invite_emails_json,
        )
