"""Team checkout billing service routines."""

from __future__ import annotations

import hashlib
import logging
from datetime import timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import AuthenticatedUser
from proliferate.config import settings
from proliferate.db.store.billing_subjects import (
    bind_stripe_customer_to_billing_subject,
    get_or_create_organization_stripe_customer_state,
)
from proliferate.db.store.organization_records import (
    CheckoutIntentRecord,
    CheckoutIntentWithOrganizationRecord,
)
from proliferate.db.store.organizations import (
    acquire_membership_activation_lock,
    bind_team_checkout_session,
    cancel_team_checkout_intent,
    create_pending_team_checkout_intent,
    get_current_membership_for_user,
    get_current_team_checkout_intent,
)
from proliferate.integrations import stripe as stripe_billing
from proliferate.server.billing.models import (
    BillingReturnSurface,
    BillingServiceError,
    utcnow,
)
from proliferate.server.billing.pricing import (
    configured_managed_cloud_overage_price_id,
    configured_pro_monthly_price_id,
    validate_pro_subscription_price_configuration,
)
from proliferate.server.billing.team_checkout.models import (
    CurrentTeamCheckoutResponse,
    TeamCheckoutIntentResponse,
    TeamCheckoutResponse,
)
from proliferate.server.organizations.domain.profile import (
    clean_organization_name,
    derive_logo_domain_from_email,
    organization_name_issue,
)

logger = logging.getLogger("proliferate.billing.team_checkout")


def _map_stripe_error(error: stripe_billing.StripeBillingError) -> BillingServiceError:
    return BillingServiceError(error.code, error.message, status_code=error.status_code)


def _with_billing_return_surface(url: str, return_surface: BillingReturnSurface) -> str:
    if return_surface == "web":
        return url
    parts = urlsplit(url)
    params = parse_qsl(parts.query, keep_blank_values=True)
    params = [(key, value) for key, value in params if key != "returnSurface"]
    params.append(("returnSurface", return_surface))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(params), parts.fragment))


def _require_redirect_urls(
    return_surface: BillingReturnSurface = "web",
) -> tuple[str, str, str]:
    success_url = settings.stripe_checkout_success_url
    cancel_url = settings.stripe_checkout_cancel_url
    portal_return_url = settings.stripe_customer_portal_return_url
    if not (success_url and cancel_url and portal_return_url):
        raise BillingServiceError(
            "stripe_redirect_urls_unconfigured",
            "Stripe redirect URLs are not configured.",
            status_code=503,
        )
    return (
        _with_billing_return_surface(success_url, return_surface),
        _with_billing_return_surface(cancel_url, return_surface),
        _with_billing_return_surface(portal_return_url, return_surface),
    )


def _idempotency_shape_suffix(*parts: str | int | UUID | None) -> str:
    payload = "\0".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _team_checkout_intent_response(
    record: CheckoutIntentRecord | CheckoutIntentWithOrganizationRecord,
) -> TeamCheckoutIntentResponse:
    intent = record.intent if hasattr(record, "intent") else record
    return TeamCheckoutIntentResponse(
        id=str(intent.id),
        organization_id=str(intent.organization_id),
        team_name=intent.team_name,
        status=intent.status,
        activation_status=intent.activation_status,
        activation_error_code=intent.activation_error_code,
        activation_error_message=intent.activation_error_message,
        checkout_url=intent.checkout_url,
        expires_at=intent.expires_at.isoformat(),
    )


def _raise_team_name_issue(team_name: str) -> str:
    issue = organization_name_issue(team_name)
    if issue is not None:
        raise BillingServiceError(issue.code, issue.message, status_code=issue.status_code)
    return clean_organization_name(team_name)


async def _ensure_stripe_customer_for_team_checkout(
    db: AsyncSession,
    *,
    user: AuthenticatedUser,
    organization_id: UUID,
    billing_subject_id: UUID,
    team_name: str,
) -> str:
    async with db.begin():
        state = await get_or_create_organization_stripe_customer_state(db, organization_id)
    if state.stripe_customer_id:
        return state.stripe_customer_id
    try:
        customer = await stripe_billing.create_customer(
            email=user.email,
            name=team_name,
            billing_subject_id=str(billing_subject_id),
            organization_id=str(organization_id),
            created_by_user_id=str(user.id),
            idempotency_key=f"customer:{billing_subject_id}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    customer_id = customer.get("id")
    if not isinstance(customer_id, str):
        raise BillingServiceError(
            "stripe_invalid_response",
            "Stripe did not return a customer id.",
            status_code=502,
        )
    async with db.begin():
        await bind_stripe_customer_to_billing_subject(
            db,
            billing_subject_id=billing_subject_id,
            stripe_customer_id=customer_id,
        )
    return customer_id


async def _create_stripe_session_for_team_checkout_intent(
    db: AsyncSession,
    *,
    user: AuthenticatedUser,
    intent_record: CheckoutIntentWithOrganizationRecord,
    success_url: str,
    cancel_url: str,
) -> TeamCheckoutResponse:
    stripe_customer_id = await _ensure_stripe_customer_for_team_checkout(
        db,
        user=user,
        organization_id=intent_record.organization.id,
        billing_subject_id=intent_record.intent.billing_subject_id,
        team_name=intent_record.intent.team_name,
    )
    monthly_price_id = configured_pro_monthly_price_id()
    overage_price_id = configured_managed_cloud_overage_price_id()
    previous_session_id = intent_record.intent.stripe_checkout_session_id or "initial"
    checkout_shape = _idempotency_shape_suffix(
        monthly_price_id,
        overage_price_id,
        1,
        success_url,
        cancel_url,
        intent_record.intent.id,
        previous_session_id,
    )
    try:
        checkout = await stripe_billing.create_subscription_checkout_session(
            stripe_customer_id=stripe_customer_id,
            billing_subject_id=str(intent_record.intent.billing_subject_id),
            organization_id=str(intent_record.organization.id),
            created_by_user_id=str(user.id),
            cloud_monthly_price_id=monthly_price_id,
            overage_price_id=overage_price_id,
            seat_quantity=1,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=f"team-checkout:{intent_record.intent.id}:{checkout_shape}",
            purpose="team_subscription",
            checkout_intent_id=str(intent_record.intent.id),
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    if checkout.id is None:
        raise BillingServiceError(
            "stripe_invalid_response",
            "Stripe did not return a checkout session id.",
            status_code=502,
        )
    async with db.begin():
        bound = await bind_team_checkout_session(
            db,
            intent_id=intent_record.intent.id,
            stripe_checkout_session_id=checkout.id,
            stripe_customer_id=stripe_customer_id,
            checkout_url=checkout.url,
        )
    if bound is None:
        raise BillingServiceError(
            "team_checkout_intent_not_found",
            "Team checkout setup could not be completed.",
            status_code=409,
        )
    return TeamCheckoutResponse(url=checkout.url, intent_id=str(intent_record.intent.id))


async def create_team_checkout_session(
    db: AsyncSession,
    user: AuthenticatedUser,
    *,
    team_name: str,
    invite_emails: list[str],
    return_surface: BillingReturnSurface = "web",
) -> TeamCheckoutResponse:
    if not settings.pro_billing_enabled:
        raise BillingServiceError(
            "org_pro_billing_disabled",
            "Team billing is not available yet.",
            status_code=409,
        )
    clean_name = _raise_team_name_issue(team_name)
    normalized_invites = sorted({email.strip().lower() for email in invite_emails if email})
    success_url, cancel_url, _portal_return_url = _require_redirect_urls(return_surface)
    await validate_pro_subscription_price_configuration()

    async with db.begin():
        await acquire_membership_activation_lock(db, user.id)
        current = await get_current_membership_for_user(db, user.id)
        if current is not None:
            raise BillingServiceError(
                "already_in_organization",
                "You already belong to a team.",
                status_code=409,
            )
        existing = await get_current_team_checkout_intent(db, user.id)
        if existing is not None:
            intent_record = existing
        else:
            intent_record = await create_pending_team_checkout_intent(
                db,
                created_by_user_id=user.id,
                team_name=clean_name,
                logo_domain=derive_logo_domain_from_email(user.email),
                idempotency_key=(
                    f"team-checkout-intent:{user.id}:"
                    f"{_idempotency_shape_suffix(clean_name, len(normalized_invites))}"
                ),
                invite_emails=normalized_invites,
                expires_at=utcnow() + timedelta(hours=24),
            )

    return await _create_stripe_session_for_team_checkout_intent(
        db,
        user=user,
        intent_record=intent_record,
        success_url=success_url,
        cancel_url=cancel_url,
    )


async def get_current_team_checkout(
    db: AsyncSession,
    user: AuthenticatedUser,
) -> CurrentTeamCheckoutResponse:
    async with db.begin():
        record = await get_current_team_checkout_intent(db, user.id)
    return CurrentTeamCheckoutResponse(
        intent=_team_checkout_intent_response(record) if record is not None else None,
    )


async def cancel_current_team_checkout(
    db: AsyncSession,
    user: AuthenticatedUser,
    intent_id: UUID,
) -> CurrentTeamCheckoutResponse:
    async with db.begin():
        record = await cancel_team_checkout_intent(
            db,
            intent_id=intent_id,
            created_by_user_id=user.id,
        )
    return CurrentTeamCheckoutResponse(
        intent=_team_checkout_intent_response(record) if record is not None else None,
    )
