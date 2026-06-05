"""Billing checkout, portal, and overage-setting service routines."""

from __future__ import annotations

import hashlib
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from proliferate.auth.authorization import (
    AuthenticatedUser,
    OwnerContext,
    OwnerSelection,
    require_org_role,
)
from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_SUBJECT_KIND_PERSONAL,
    PRO_OVERAGE_CAP_CENTS_PER_SEAT_MAX,
)
from proliferate.constants.organizations import ORGANIZATION_ROLE_ADMIN, ORGANIZATION_ROLE_OWNER
from proliferate.db.store import billing_seats
from proliferate.db.store.billing_subjects import (
    bind_stripe_customer_to_billing_subject,
    get_or_create_organization_stripe_customer_state,
    get_or_create_user_stripe_customer_state,
    set_overage_policy_for_subject,
    set_overage_policy_for_user,
)
from proliferate.db.store.organizations import (
    get_organization_with_membership,
    load_organization_by_billing_subject,
)
from proliferate.errors import ProliferateError
from proliferate.integrations import stripe as stripe_billing
from proliferate.server.billing.models import (
    BillingReturnSurface,
    BillingServiceError,
    BillingUrlResponse,
    OverageSettingsResponse,
)
from proliferate.server.billing.pricing import (
    configured_managed_cloud_overage_price_id,
    configured_pro_monthly_price_id,
    validate_cloud_subscription_price_configuration,
    validate_pro_subscription_price_configuration,
    validate_refill_price_configuration,
)
from proliferate.server.billing.snapshots import get_billing_snapshot_for_subject_in_session


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


def _idempotency_shape_suffix(*parts: str | int | None) -> str:
    payload = "\0".join("" if part is None else str(part) for part in parts)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _require_owner_selection_uuid(value: str | UUID | None, *, field: str) -> UUID:
    if isinstance(value, UUID):
        return value
    if value:
        try:
            return UUID(value)
        except ValueError as exc:
            raise BillingServiceError(
                "invalid_organization_id",
                f"{field} must be a valid UUID.",
                status_code=400,
            ) from exc
    raise BillingServiceError(
        "missing_organization_id",
        f"{field} is required for organization scope.",
        status_code=400,
    )


async def resolve_billing_owner_context(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection,
) -> OwnerContext:
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "personal":
        if selection.organization_id is not None:
            raise BillingServiceError(
                "invalid_owner_selection",
                "organizationId is not valid for personal scope.",
                status_code=400,
            )
        state = await get_or_create_user_stripe_customer_state(db, user.id)
        if state.kind != BILLING_SUBJECT_KIND_PERSONAL:
            raise BillingServiceError(
                "invalid_owner_selection",
                "Personal billing subject could not be resolved.",
                status_code=500,
            )
        return OwnerContext(
            owner_scope="personal",
            actor_user_id=user.id,
            owner_user_id=user.id,
            organization_id=None,
            membership_id=None,
            membership_role=None,
            billing_subject_id=state.billing_subject_id,
        )

    organization_id = _require_owner_selection_uuid(
        selection.organization_id,
        field="organizationId",
    )
    record = await get_organization_with_membership(
        db,
        organization_id=organization_id,
        user_id=user.id,
    )
    if record is None:
        raise BillingServiceError(
            "organization_not_found",
            "Organization not found.",
            status_code=404,
        )
    state = await get_or_create_organization_stripe_customer_state(db, organization_id)
    return OwnerContext(
        owner_scope="organization",
        actor_user_id=user.id,
        owner_user_id=None,
        organization_id=organization_id,
        membership_id=record.membership.id,
        membership_role=record.membership.role,
        billing_subject_id=state.billing_subject_id,
    )


async def _ensure_stripe_customer_for_owner(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection,
    *,
    owner_context: OwnerContext | None = None,
) -> tuple[UUID, str]:
    async with db.begin():
        context = owner_context or await resolve_billing_owner_context(db, user, owner_selection)
        if context.owner_scope == "organization":
            try:
                require_org_role(context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
            except ProliferateError as error:
                raise BillingServiceError(
                    error.code,
                    error.message,
                    status_code=error.status_code,
                ) from error
            if context.organization_id is None:
                raise BillingServiceError(
                    "organization_not_found",
                    "Organization not found.",
                    status_code=404,
                )
            state = await get_or_create_organization_stripe_customer_state(
                db,
                context.organization_id,
            )
            organization = await load_organization_by_billing_subject(
                db,
                state.billing_subject_id,
            )
            customer_name = organization.name if organization is not None else "Organization"
            organization_id = str(context.organization_id)
            created_by_user_id = str(user.id)
        else:
            state = await get_or_create_user_stripe_customer_state(db, user.id)
            customer_name = None
            organization_id = None
            created_by_user_id = None
    if state.stripe_customer_id:
        return state.billing_subject_id, state.stripe_customer_id
    try:
        customer = await stripe_billing.create_customer(
            email=user.email,
            name=customer_name,
            billing_subject_id=str(state.billing_subject_id),
            organization_id=organization_id,
            created_by_user_id=created_by_user_id,
            idempotency_key=f"customer:{state.billing_subject_id}",
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
        state = await bind_stripe_customer_to_billing_subject(
            db,
            billing_subject_id=state.billing_subject_id,
            stripe_customer_id=customer_id,
        )
    return state.billing_subject_id, customer_id


async def create_cloud_checkout_session(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection | None = None,
    return_surface: BillingReturnSurface = "web",
) -> BillingUrlResponse:
    selection = owner_selection or OwnerSelection()
    org_context: OwnerContext | None = None
    if selection.owner_scope == "organization":
        async with db.begin():
            org_context = await resolve_billing_owner_context(db, user, selection)
            try:
                require_org_role(org_context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
            except ProliferateError as error:
                raise BillingServiceError(
                    error.code,
                    error.message,
                    status_code=error.status_code,
                ) from error
        if not settings.pro_billing_enabled:
            raise BillingServiceError(
                "org_pro_billing_disabled",
                "Organization Pro billing is not available yet.",
                status_code=409,
            )
    success_url, cancel_url, portal_return_url = _require_redirect_urls(return_surface)
    if settings.pro_billing_enabled:
        await validate_pro_subscription_price_configuration()
    else:
        await validate_cloud_subscription_price_configuration()

    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
        user,
        selection,
        owner_context=org_context,
    )
    async with db.begin():
        snapshot = await get_billing_snapshot_for_subject_in_session(db, subject_id)
        seat_quantity = (
            await billing_seats.count_active_seats_for_billing_subject_id(db, subject_id)
            if org_context is not None and not snapshot.is_paid_cloud
            else 1
        )
    if snapshot.is_paid_cloud:
        try:
            portal = await stripe_billing.create_customer_portal_session(
                stripe_customer_id=stripe_customer_id,
                return_url=portal_return_url,
                idempotency_key=(
                    f"portal:active-cloud:{subject_id}:"
                    f"{_idempotency_shape_suffix(portal_return_url)}"
                ),
            )
        except stripe_billing.StripeBillingError as error:
            raise _map_stripe_error(error) from error
        return BillingUrlResponse(url=portal.url)

    try:
        monthly_price_id = (
            configured_pro_monthly_price_id()
            if settings.pro_billing_enabled
            else settings.stripe_cloud_monthly_price_id
        )
        overage_price_id = (
            configured_managed_cloud_overage_price_id() if settings.pro_billing_enabled else None
        )
        checkout_shape = _idempotency_shape_suffix(
            monthly_price_id,
            overage_price_id,
            seat_quantity,
            success_url,
            cancel_url,
        )
        checkout = await stripe_billing.create_subscription_checkout_session(
            stripe_customer_id=stripe_customer_id,
            billing_subject_id=str(subject_id),
            organization_id=(
                str(org_context.organization_id)
                if org_context is not None and org_context.organization_id is not None
                else None
            ),
            created_by_user_id=str(user.id) if org_context is not None else None,
            cloud_monthly_price_id=monthly_price_id,
            overage_price_id=overage_price_id,
            seat_quantity=seat_quantity,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=(
                f"cloud-checkout:org:{subject_id}:seats:{seat_quantity}:{checkout_shape}"
                if org_context is not None
                else f"cloud-checkout:{subject_id}:{checkout_shape}"
            ),
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingUrlResponse(url=checkout.url)


async def create_refill_checkout_session(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection | None = None,
    return_surface: BillingReturnSurface = "web",
) -> BillingUrlResponse:
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "organization":
        raise BillingServiceError(
            "refill_checkout_not_supported_for_org",
            "Refill checkout is not supported for organizations.",
            status_code=409,
        )
    if settings.pro_billing_enabled:
        raise BillingServiceError(
            "refill_checkout_disabled",
            "Refill checkout is not available for Pro billing.",
            status_code=409,
        )
    success_url, cancel_url, _portal_return_url = _require_redirect_urls(return_surface)
    await validate_refill_price_configuration()
    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
        user,
        selection,
    )
    refill_shape = _idempotency_shape_suffix(
        settings.stripe_refill_10h_price_id,
        success_url,
        cancel_url,
    )
    try:
        checkout = await stripe_billing.create_refill_checkout_session(
            stripe_customer_id=stripe_customer_id,
            billing_subject_id=str(subject_id),
            refill_price_id=settings.stripe_refill_10h_price_id,
            success_url=success_url,
            cancel_url=cancel_url,
            idempotency_key=f"refill-10h:{subject_id}:{refill_shape}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingUrlResponse(url=checkout.url)


async def create_customer_portal_session(
    db: AsyncSession,
    user: AuthenticatedUser,
    owner_selection: OwnerSelection | None = None,
    return_surface: BillingReturnSurface = "web",
) -> BillingUrlResponse:
    _success_url, _cancel_url, portal_return_url = _require_redirect_urls(return_surface)
    subject_id, stripe_customer_id = await _ensure_stripe_customer_for_owner(
        db,
        user,
        owner_selection or OwnerSelection(),
    )
    try:
        portal = await stripe_billing.create_customer_portal_session(
            stripe_customer_id=stripe_customer_id,
            return_url=portal_return_url,
            idempotency_key=f"portal:{subject_id}:{_idempotency_shape_suffix(portal_return_url)}",
        )
    except stripe_billing.StripeBillingError as error:
        raise _map_stripe_error(error) from error
    return BillingUrlResponse(url=portal.url)


async def update_overage_settings(
    db: AsyncSession,
    user: AuthenticatedUser,
    *,
    enabled: bool,
    cap_cents_per_seat: int | None = None,
    owner_selection: OwnerSelection | None = None,
) -> OverageSettingsResponse:
    if cap_cents_per_seat is not None and not (
        0 <= cap_cents_per_seat <= PRO_OVERAGE_CAP_CENTS_PER_SEAT_MAX
    ):
        raise BillingServiceError(
            "invalid_overage_cap",
            "Overage cap must be between 0 and 1000000 cents per seat.",
            status_code=400,
        )
    selection = owner_selection or OwnerSelection()
    if selection.owner_scope == "personal":
        subject = await set_overage_policy_for_user(
            db,
            user_id=user.id,
            overage_enabled=enabled,
            overage_cap_cents_per_seat=cap_cents_per_seat,
        )
    else:
        context = await resolve_billing_owner_context(db, user, selection)
        try:
            require_org_role(context, {ORGANIZATION_ROLE_OWNER, ORGANIZATION_ROLE_ADMIN})
        except ProliferateError as error:
            raise BillingServiceError(
                error.code,
                error.message,
                status_code=error.status_code,
            ) from error
        subject = await set_overage_policy_for_subject(
            db,
            billing_subject_id=context.billing_subject_id,
            overage_enabled=enabled,
            overage_cap_cents_per_seat=cap_cents_per_seat,
        )
    return OverageSettingsResponse(
        overage_enabled=enabled,
        overage_cap_cents_per_seat=subject.overage_cap_cents_per_seat,
    )
