from __future__ import annotations

import asyncio
import uuid
from base64 import b64encode
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.config import settings
from proliferate.constants.billing import (
    BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
    MONTHLY_CLOUD_GRANT_TYPE,
    PRO_SEAT_PRORATION_GRANT_TYPE,
)
from proliferate.constants.cloud import CloudRuntimeEnvironmentStatus
from proliferate.constants.organizations import (
    ORGANIZATION_CHECKOUT_INTENT_STATUS_PENDING,
    ORGANIZATION_INVITATION_DELIVERY_SKIPPED,
    ORGANIZATION_INVITATION_STATUS_PENDING,
    ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
    ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
    ORGANIZATION_ROLE_MEMBER,
    ORGANIZATION_ROLE_OWNER,
    ORGANIZATION_STATUS_PENDING_CHECKOUT,
)
from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingGrant,
    BillingSeatAdjustment,
    BillingSubscription,
    BillingUsageExport,
    UsageSegment,
)
from proliferate.db.models.cloud.agent_auth import SandboxProfile
from proliferate.db.models.cloud.targets import CloudTarget
from proliferate.db.models.cloud.sandboxes import CloudSandbox
from proliferate.db.models.cloud.workspaces import CloudWorkspace
from proliferate.db.models.organizations import (
    Organization,
    OrganizationCheckoutIntent,
    OrganizationInvitation,
    OrganizationMembership,
)
from proliferate.db.store.billing_subjects import (
    ensure_billing_grant,
    ensure_free_included_grant,
    ensure_organization_billing_subject,
    ensure_personal_billing_subject,
)
from proliferate.db.store.cloud_runtime_environments import (
    ensure_runtime_environment_for_workspace,
)
from proliferate.integrations import resend
from proliferate.integrations import stripe as stripe_billing
from proliferate.integrations.github import GitHubRepoBranches
from proliferate.server.billing.service import (
    maybe_create_organization_seat_adjustment as maybe_create_org_seat_adjustment,
    process_pending_seat_adjustments,
)
from proliferate.server.billing.team_checkout.activation import (
    activate_team_checkout_from_stripe_session,
)
from proliferate.server.cloud.workspaces.provisioning import preflight as provisioning_preflight
from proliferate.server.cloud.workspaces.provisioning import service as provisioning_service
from tests.helpers.desktop_auth import mint_desktop_token_payload


def _claude_file_payload(api_key: str) -> dict[str, object]:
    return {
        "authMode": "file",
        "files": [
            {
                "relativePath": ".claude/.credentials.json",
                "contentBase64": b64encode(
                    f'{{"claudeAiOauth":{{"accessToken":"{api_key}"}}}}'.encode()
                ).decode(),
            }
        ],
    }


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager
    from proliferate.db.engine import get_async_session
    from proliferate.db.models.auth import OAuthAccount
    from proliferate.auth.users import get_user_db

    user_id: str | None = None
    async for session in get_async_session():
        async for user_db in get_user_db(session):
            manager = UserManager(user_db)
            user = await manager.create(
                UserCreate(
                    email=email,
                    password="unused-oauth-only",
                    display_name="Billing Tester",
                ),
            )
            session.add(
                OAuthAccount(
                    user_id=user.id,
                    oauth_name="github",
                    access_token="github-access-token",
                    account_id=f"github-{user.id}",
                    account_email=email,
                )
            )
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None

    token_data = await mint_desktop_token_payload(
        client,
        user_id=user_id,
        state_prefix="billing-state",
    )
    return {
        "user_id": user_id,
        "access_token": str(token_data["access_token"]),
    }


async def _link_github_account(db_session: AsyncSession, user_id: str) -> None:
    account = OAuthAccount(
        user_id=uuid.UUID(user_id),
        oauth_name="github",
        access_token="github-access-token",
        account_id="12345",
        account_email="billing@example.com",
    )
    db_session.add(account)
    await db_session.commit()


@pytest.mark.asyncio
async def test_ensure_free_included_grant_is_concurrent_safe(
    test_engine,  # type: ignore[no-untyped-def]
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "cloud_free_sandbox_hours", 12.0)
    user_id = uuid.uuid4()
    session_factory = async_sessionmaker(test_engine, expire_on_commit=False)

    async def _create_grant() -> bool:
        async with session_factory() as session:
            created = await ensure_free_included_grant(session, user_id)
            await session.commit()
            return created

    created_flags = await asyncio.gather(_create_grant(), _create_grant())
    assert sorted(created_flags) == [False, True]

    async with session_factory() as session:
        grants = list(
            (await session.execute(select(BillingGrant).where(BillingGrant.user_id == user_id)))
            .scalars()
            .all()
        )

    assert len(grants) == 1
    assert grants[0].grant_type == "free_included"
    assert grants[0].hours_granted == 12.0
    assert grants[0].remaining_seconds == 12.0 * 3600.0


class TestBillingApi:
    @pytest.mark.asyncio
    async def test_overview_and_plan_default_to_free_included_hours(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "cloud_free_sandbox_hours", 20.0)
        monkeypatch.setattr(settings, "cloud_billing_mode", "off")
        monkeypatch.setattr(settings, "pro_billing_enabled", False)

        session = await _register_and_login(client, "billing-overview@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        overview_response = await client.get("/v1/billing/overview", headers=headers)
        assert overview_response.status_code == 200
        overview = overview_response.json()
        assert overview == {
            "plan": "free",
            "billingMode": "off",
            "proBillingEnabled": False,
            "isUnlimited": False,
            "hasUnlimitedCloudHours": False,
            "overQuota": False,
            "includedHours": 20.0,
            "usedHours": 0.0,
            "remainingHours": 20.0,
            "cloudRepoLimit": settings.cloud_free_repo_limit,
            "activeCloudRepoCount": 0,
            "concurrentSandboxLimit": settings.cloud_concurrent_sandbox_limit,
            "activeSandboxCount": 0,
            "isPaidCloud": False,
            "paymentHealthy": False,
            "overageEnabled": False,
            "hostedInvoiceUrl": None,
            "startBlocked": False,
            "startBlockReason": None,
            "activeSpendHold": False,
            "holdReason": None,
            "billableSeatCount": None,
            "includedManagedCloudHours": None,
            "remainingManagedCloudHours": None,
            "managedCloudOverageEnabled": False,
            "managedCloudOverageCapCents": None,
            "managedCloudOverageUsedCents": 0,
            "overagePricePerHourCents": 200,
            "activeEnvironmentLimit": settings.cloud_concurrent_sandbox_limit,
            "repoEnvironmentLimit": settings.cloud_free_repo_limit,
            "byoRuntimeAllowed": False,
            "legacyCloudSubscription": False,
        }

        compat_response = await client.get("/v1/billing/plan", headers=headers)
        assert compat_response.status_code == 200
        assert compat_response.json() == {
            "plan": "free",
            "usageMinutes": 0,
            "proBillingEnabled": False,
        }

        cloud_plan_response = await client.get("/v1/billing/cloud-plan", headers=headers)
        assert cloud_plan_response.status_code == 200
        assert cloud_plan_response.json() == {
            "plan": "free",
            "billingMode": "off",
            "proBillingEnabled": False,
            "isUnlimited": False,
            "hasUnlimitedCloudHours": False,
            "overQuota": False,
            "freeSandboxHours": 20.0,
            "usedSandboxHours": 0.0,
            "remainingSandboxHours": 20.0,
            "cloudRepoLimit": settings.cloud_free_repo_limit,
            "activeCloudRepoCount": 0,
            "concurrentSandboxLimit": settings.cloud_concurrent_sandbox_limit,
            "activeSandboxCount": 0,
            "isPaidCloud": False,
            "paymentHealthy": False,
            "overageEnabled": False,
            "hostedInvoiceUrl": None,
            "startBlocked": False,
            "startBlockReason": None,
            "activeSpendHold": False,
            "holdReason": None,
            "billableSeatCount": None,
            "includedManagedCloudHours": None,
            "remainingManagedCloudHours": None,
            "managedCloudOverageEnabled": False,
            "managedCloudOverageCapCents": None,
            "managedCloudOverageUsedCents": 0,
            "overagePricePerHourCents": 200,
            "activeEnvironmentLimit": settings.cloud_concurrent_sandbox_limit,
            "repoEnvironmentLimit": settings.cloud_free_repo_limit,
            "byoRuntimeAllowed": False,
            "legacyCloudSubscription": False,
            "grantAllocations": [
                {
                    "grantType": "free_included",
                    "totalSeconds": 20.0 * 3600,
                    "consumedSeconds": 0.0,
                    "remainingSeconds": 20.0 * 3600,
                    "active": True,
                }
            ],
        }

    @pytest.mark.asyncio
    async def test_paid_cloud_plan_has_unlimited_hours_after_signup(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "cloud_free_sandbox_hours", 20.0)
        monkeypatch.setattr(settings, "cloud_billing_mode", "off")
        monkeypatch.setattr(settings, "pro_billing_enabled", False)
        monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")

        session = await _register_and_login(client, "billing-paid-carry@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        subject = await ensure_personal_billing_subject(db_session, user_id)
        await ensure_free_included_grant(db_session, user_id)
        now = datetime.now(UTC)
        await ensure_billing_grant(
            db_session,
            user_id=user_id,
            billing_subject_id=subject.id,
            grant_type=MONTHLY_CLOUD_GRANT_TYPE,
            hours_granted=100.0,
            effective_at=now - timedelta(hours=1),
            expires_at=now + timedelta(days=30),
            source_ref=f"stripe:invoice:{uuid.uuid4()}:cloud_monthly",
        )
        db_session.add(
            BillingSubscription(
                billing_subject_id=subject.id,
                stripe_subscription_id="sub_paid_carry",
                stripe_customer_id="cus_paid_carry",
                status="active",
                cancel_at_period_end=False,
                canceled_at=None,
                current_period_start=now - timedelta(hours=1),
                current_period_end=now + timedelta(days=30),
                cloud_monthly_price_id="price_cloud",
                overage_price_id="price_overage",
                monthly_subscription_item_id="si_monthly",
                metered_subscription_item_id="si_metered",
                latest_invoice_id=None,
                latest_invoice_status=None,
                hosted_invoice_url=None,
            )
        )
        await db_session.commit()

        response = await client.get("/v1/billing/cloud-plan", headers=headers)

        assert response.status_code == 200
        payload = response.json()
        assert payload["plan"] == "cloud"
        assert payload["isPaidCloud"] is True
        assert payload["isUnlimited"] is False
        assert payload["hasUnlimitedCloudHours"] is True
        assert payload["freeSandboxHours"] is None
        assert payload["remainingSandboxHours"] is None
        assert payload["cloudRepoLimit"] == settings.cloud_paid_repo_limit
        assert payload["activeCloudRepoCount"] == 0
        assert payload["concurrentSandboxLimit"] is None

    @pytest.mark.asyncio
    async def test_cloud_checkout_routes_paid_subject_to_portal(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", False)
        monkeypatch.setattr(settings, "stripe_cloud_monthly_price_id", "price_cloud")
        monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://app.test/success")
        monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://app.test/cancel")
        monkeypatch.setattr(
            settings,
            "stripe_customer_portal_return_url",
            "https://app.test/portal",
        )
        captured: dict[str, object] = {}

        async def fake_validate_cloud_subscription_price_configuration() -> None:
            captured["validated"] = True

        async def fake_create_subscription_checkout_session(**_kwargs: object) -> object:
            raise AssertionError("paid subjects should not get duplicate checkout sessions")

        async def fake_create_customer_portal_session(
            **kwargs: object,
        ) -> stripe_billing.StripeUrlResponse:
            captured["portal"] = kwargs
            return stripe_billing.StripeUrlResponse(url="https://portal.test/active")

        monkeypatch.setattr(
            "proliferate.server.billing.service.validate_cloud_subscription_price_configuration",
            fake_validate_cloud_subscription_price_configuration,
        )
        monkeypatch.setattr(
            stripe_billing,
            "create_subscription_checkout_session",
            fake_create_subscription_checkout_session,
        )
        monkeypatch.setattr(
            stripe_billing,
            "create_customer_portal_session",
            fake_create_customer_portal_session,
        )

        session = await _register_and_login(client, "billing-checkout-portal@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        subject = await ensure_personal_billing_subject(db_session, user_id)
        subject.stripe_customer_id = "cus_checkout_portal"
        now = datetime.now(UTC)
        db_session.add(
            BillingSubscription(
                billing_subject_id=subject.id,
                stripe_subscription_id="sub_checkout_portal",
                stripe_customer_id="cus_checkout_portal",
                status="active",
                cancel_at_period_end=False,
                canceled_at=None,
                current_period_start=now - timedelta(days=1),
                current_period_end=now + timedelta(days=29),
                cloud_monthly_price_id="price_cloud",
                overage_price_id=None,
                monthly_subscription_item_id="si_checkout_portal",
                metered_subscription_item_id=None,
                latest_invoice_id=None,
                latest_invoice_status=None,
                hosted_invoice_url=None,
            )
        )
        await db_session.commit()

        response = await client.post(
            "/v1/billing/cloud-checkout",
            headers=headers,
            json={"returnSurface": "desktop"},
        )

        assert response.status_code == 200
        assert response.json() == {"url": "https://portal.test/active"}
        portal = captured["portal"]
        assert isinstance(portal, dict)
        assert portal["stripe_customer_id"] == "cus_checkout_portal"
        assert portal["return_url"] == "https://app.test/portal?returnSurface=desktop"
        assert portal["idempotency_key"].startswith(f"portal:active-cloud:{subject.id}:")

    @pytest.mark.asyncio
    async def test_team_checkout_creates_pending_org_without_membership(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
        monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")
        monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://app.test/success")
        monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://app.test/cancel")
        monkeypatch.setattr(
            settings,
            "stripe_customer_portal_return_url",
            "https://app.test/portal",
        )
        captured: dict[str, object] = {"checkout_calls": []}

        async def fake_validate_pro_subscription_price_configuration() -> None:
            captured["validated"] = True

        async def fake_create_customer(**kwargs: object) -> dict[str, str]:
            captured["customer"] = kwargs
            return {"id": "cus_team_checkout"}

        async def fake_create_subscription_checkout_session(
            **kwargs: object,
        ) -> stripe_billing.StripeUrlResponse:
            captured["checkout"] = kwargs
            checkout_calls = captured["checkout_calls"]
            assert isinstance(checkout_calls, list)
            checkout_calls.append(kwargs)
            attempt = len(checkout_calls)
            return stripe_billing.StripeUrlResponse(
                url=f"https://checkout.test/team-{attempt}",
                id=f"cs_team_checkout_{attempt}",
            )

        monkeypatch.setattr(
            "proliferate.server.billing.team_checkout.service.validate_pro_subscription_price_configuration",
            fake_validate_pro_subscription_price_configuration,
        )
        monkeypatch.setattr(stripe_billing, "create_customer", fake_create_customer)
        monkeypatch.setattr(
            stripe_billing,
            "create_subscription_checkout_session",
            fake_create_subscription_checkout_session,
        )

        session = await _register_and_login(client, "billing-team-checkout@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        response = await client.post(
            "/v1/billing/team-checkout",
            headers=headers,
            json={"teamName": "Acme Research", "inviteEmails": ["teammate@example.com"]},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["url"] == "https://checkout.test/team-1"
        assert body["intentId"]
        assert captured["validated"] is True
        checkout = captured["checkout"]
        assert isinstance(checkout, dict)
        assert checkout["purpose"] == "team_subscription"
        assert checkout["checkout_intent_id"] == body["intentId"]
        assert checkout["seat_quantity"] == 1

        organizations = await client.get("/v1/organizations", headers=headers)
        assert organizations.status_code == 200
        assert organizations.json() == {"organizations": []}

        intent = await db_session.get(OrganizationCheckoutIntent, uuid.UUID(body["intentId"]))
        assert intent is not None
        assert intent.status == ORGANIZATION_CHECKOUT_INTENT_STATUS_PENDING
        assert intent.checkout_url == "https://checkout.test/team-1"
        assert intent.stripe_checkout_session_id == "cs_team_checkout_1"
        organization = await db_session.get(Organization, intent.organization_id)
        assert organization is not None
        assert organization.status == ORGANIZATION_STATUS_PENDING_CHECKOUT
        membership = (
            await db_session.execute(
                select(OrganizationMembership).where(
                    OrganizationMembership.user_id == uuid.UUID(session["user_id"])
                )
            )
        ).scalar_one_or_none()
        assert membership is None

        current = await client.get("/v1/billing/team-checkout/current", headers=headers)
        assert current.status_code == 200
        assert current.json()["intent"]["id"] == body["intentId"]

        reused = await client.post(
            "/v1/billing/team-checkout",
            headers=headers,
            json={"teamName": "Acme Research"},
        )
        assert reused.status_code == 200
        reused_body = reused.json()
        assert reused_body["intentId"] == body["intentId"]
        assert reused_body["url"] == "https://checkout.test/team-2"
        checkout_calls = captured["checkout_calls"]
        assert isinstance(checkout_calls, list)
        assert len(checkout_calls) == 2
        assert checkout_calls[0]["idempotency_key"] != checkout_calls[1]["idempotency_key"]

        db_session.expire_all()
        intent = await db_session.get(OrganizationCheckoutIntent, uuid.UUID(body["intentId"]))
        assert intent is not None
        assert intent.checkout_url == "https://checkout.test/team-2"
        assert intent.stripe_checkout_session_id == "cs_team_checkout_2"

    @pytest.mark.asyncio
    async def test_team_checkout_activation_creates_team_and_shared_sandbox(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
        monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")
        monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://app.test/success")
        monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://app.test/cancel")
        monkeypatch.setattr(
            settings,
            "stripe_customer_portal_return_url",
            "https://app.test/portal",
        )

        async def fake_validate_pro_subscription_price_configuration() -> None:
            return None

        async def fake_create_customer(**_kwargs: object) -> dict[str, str]:
            return {"id": "cus_team_activation"}

        async def fake_create_subscription_checkout_session(
            **_kwargs: object,
        ) -> stripe_billing.StripeUrlResponse:
            return stripe_billing.StripeUrlResponse(
                url="https://checkout.test/team-activation",
                id="cs_team_activation",
            )

        monkeypatch.setattr(
            "proliferate.server.billing.team_checkout.service.validate_pro_subscription_price_configuration",
            fake_validate_pro_subscription_price_configuration,
        )
        monkeypatch.setattr(stripe_billing, "create_customer", fake_create_customer)
        monkeypatch.setattr(
            stripe_billing,
            "create_subscription_checkout_session",
            fake_create_subscription_checkout_session,
        )
        sent_invites: list[dict[str, str]] = []

        async def fake_send_organization_invitation_email(
            **kwargs: str,
        ) -> resend.ResendEmailResult:
            sent_invites.append(dict(kwargs))
            return resend.ResendEmailResult(provider_message_id=None, skipped=True)

        monkeypatch.setattr(
            resend,
            "send_organization_invitation_email",
            fake_send_organization_invitation_email,
        )

        session = await _register_and_login(client, "billing-team-activation@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        response = await client.post(
            "/v1/billing/team-checkout",
            headers=headers,
            json={
                "teamName": "Activation Team",
                "inviteEmails": ["New.Member@example.com"],
            },
        )
        assert response.status_code == 200
        intent_id = uuid.UUID(response.json()["intentId"])
        db_session.expire_all()
        intent = await db_session.get(OrganizationCheckoutIntent, intent_id)
        assert intent is not None
        organization_id = intent.organization_id
        created_by_user_id = intent.created_by_user_id
        billing_subject_id = intent.billing_subject_id
        metadata = {
            "purpose": "team_subscription",
            "organization_checkout_intent_id": str(intent.id),
            "organization_id": str(organization_id),
            "created_by_user_id": str(created_by_user_id),
            "billing_subject_id": str(billing_subject_id),
        }

        async def fake_retrieve_subscription(_subscription_id: str) -> dict[str, object]:
            return {
                "id": "sub_team_activation",
                "customer": "cus_team_activation",
                "status": "active",
                "cancel_at_period_end": False,
                "latest_invoice": "in_team_activation",
                "metadata": metadata,
                "items": {
                    "data": [
                        {
                            "id": "si_team_activation_monthly",
                            "price": {"id": "price_pro"},
                            "quantity": 1,
                            "current_period_start": 1_776_586_422,
                            "current_period_end": 1_779_178_422,
                        },
                        {
                            "id": "si_team_activation_overage",
                            "price": {"id": "price_overage"},
                            "current_period_start": 1_776_586_422,
                            "current_period_end": 1_779_178_422,
                        },
                    ]
                },
            }

        monkeypatch.setattr(stripe_billing, "retrieve_subscription", fake_retrieve_subscription)

        await activate_team_checkout_from_stripe_session(
            session={
                "id": "cs_team_activation",
                "customer": "cus_team_activation",
                "subscription": "sub_team_activation",
                "metadata": metadata,
            },
            webhook_event_id="evt_team_activation",
        )

        db_session.expire_all()
        organization = await db_session.get(Organization, organization_id)
        assert organization is not None
        assert organization.status == "active"
        membership = (
            await db_session.execute(
                select(OrganizationMembership).where(
                    OrganizationMembership.organization_id == organization.id,
                    OrganizationMembership.user_id == uuid.UUID(session["user_id"]),
                )
            )
        ).scalar_one()
        assert membership.role == ORGANIZATION_ROLE_OWNER
        assert membership.status == ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
        subscription = (
            await db_session.execute(
                select(BillingSubscription).where(
                    BillingSubscription.stripe_subscription_id == "sub_team_activation"
                )
            )
        ).scalar_one()
        assert subscription.billing_subject_id == billing_subject_id
        profile = (
            await db_session.execute(
                select(SandboxProfile).where(SandboxProfile.organization_id == organization.id)
            )
        ).scalar_one()
        target = (
            await db_session.execute(
                select(CloudTarget).where(CloudTarget.sandbox_profile_id == profile.id)
            )
        ).scalar_one()
        assert target.display_name == "Shared cloud sandbox"
        assert target.profile_target_role == "primary"
        invitation = (
            await db_session.execute(
                select(OrganizationInvitation).where(
                    OrganizationInvitation.organization_id == organization.id
                )
            )
        ).scalar_one()
        assert invitation.email == "new.member@example.com"
        assert invitation.role == ORGANIZATION_ROLE_MEMBER
        assert invitation.status == ORGANIZATION_INVITATION_STATUS_PENDING
        assert invitation.delivery_status == ORGANIZATION_INVITATION_DELIVERY_SKIPPED
        assert len(sent_invites) == 1
        assert sent_invites[0]["to_email"] == "new.member@example.com"
        assert sent_invites[0]["organization_name"] == "Activation Team"
        assert sent_invites[0]["inviter_email"] == "billing-team-activation@example.com"
        invite_base_url = (settings.api_base_url or settings.frontend_base_url).rstrip("/")
        assert sent_invites[0]["invite_url"].startswith(
            f"{invite_base_url}/v1/organizations/invitations/landing?token="
        )

        organizations = await client.get("/v1/organizations", headers=headers)
        assert organizations.status_code == 200
        assert organizations.json()["organizations"][0]["name"] == "Activation Team"

    @pytest.mark.asyncio
    async def test_pro_overage_used_is_scoped_to_current_period(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        monkeypatch.setattr(settings, "cloud_billing_mode", "enforce")
        monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
        monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")

        session = await _register_and_login(client, "billing-pro-period@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        subject = await ensure_personal_billing_subject(db_session, user_id)
        subject.overage_enabled = True
        subject.overage_cap_cents_per_seat = 2000
        now = datetime.now(UTC)
        period_start = now - timedelta(days=1)
        period_end = now + timedelta(days=29)
        subscription = BillingSubscription(
            billing_subject_id=subject.id,
            stripe_subscription_id="sub_pro_period",
            stripe_customer_id="cus_pro_period",
            status="active",
            cancel_at_period_end=False,
            canceled_at=None,
            current_period_start=period_start,
            current_period_end=period_end,
            cloud_monthly_price_id="price_pro",
            overage_price_id="price_overage",
            monthly_subscription_item_id="si_monthly",
            metered_subscription_item_id="si_metered",
            latest_invoice_id=None,
            latest_invoice_status=None,
            hosted_invoice_url=None,
            seat_quantity=1,
        )
        db_session.add(subscription)
        await db_session.flush()
        db_session.add_all(
            [
                BillingUsageExport(
                    billing_subject_id=subject.id,
                    billing_subscription_id=subscription.id,
                    usage_segment_id=uuid.uuid4(),
                    period_start=period_start - timedelta(days=30),
                    period_end=period_start,
                    accounted_from=period_start - timedelta(days=2),
                    accounted_until=period_start - timedelta(days=2) + timedelta(hours=1),
                    quantity_seconds=3600.0,
                    meter_quantity_cents=2000,
                    cap_cents_snapshot=2000,
                    cap_used_cents_snapshot=0,
                    idempotency_key=f"old-period:{uuid.uuid4()}",
                    status=BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
                ),
                BillingUsageExport(
                    billing_subject_id=subject.id,
                    billing_subscription_id=subscription.id,
                    usage_segment_id=uuid.uuid4(),
                    period_start=period_start,
                    period_end=period_end,
                    accounted_from=period_start + timedelta(hours=1),
                    accounted_until=period_start + timedelta(hours=2),
                    quantity_seconds=900.0,
                    meter_quantity_cents=500,
                    cap_cents_snapshot=2000,
                    cap_used_cents_snapshot=0,
                    idempotency_key=f"current-period:{uuid.uuid4()}",
                    status=BILLING_USAGE_EXPORT_STATUS_SUCCEEDED,
                ),
            ]
        )
        await db_session.commit()

        response = await client.get("/v1/billing/cloud-plan", headers=headers)

        assert response.status_code == 200
        payload = response.json()
        assert payload["plan"] == "pro"
        assert payload["managedCloudOverageCapCents"] == 2000
        assert payload["managedCloudOverageUsedCents"] == 500
        assert payload["startBlocked"] is False

    @pytest.mark.asyncio
    async def test_org_cloud_checkout_is_pro_only_and_uses_active_seats(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
        monkeypatch.setattr(settings, "stripe_managed_cloud_overage_price_id", "price_overage")
        monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://app.test/success")
        monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://app.test/cancel")
        monkeypatch.setattr(
            settings,
            "stripe_customer_portal_return_url",
            "https://app.test/portal",
        )
        captured: dict[str, object] = {}

        async def fake_validate_pro_subscription_price_configuration() -> None:
            captured["validated"] = True

        async def fake_create_customer(**kwargs: object) -> dict[str, str]:
            captured["customer"] = kwargs
            return {"id": "cus_org_checkout"}

        async def fake_create_subscription_checkout_session(
            **kwargs: object,
        ) -> stripe_billing.StripeUrlResponse:
            captured["checkout"] = kwargs
            return stripe_billing.StripeUrlResponse(url="https://checkout.test/org")

        monkeypatch.setattr(
            "proliferate.server.billing.service.validate_pro_subscription_price_configuration",
            fake_validate_pro_subscription_price_configuration,
        )
        monkeypatch.setattr(stripe_billing, "create_customer", fake_create_customer)
        monkeypatch.setattr(
            stripe_billing,
            "create_subscription_checkout_session",
            fake_create_subscription_checkout_session,
        )

        owner_session = await _register_and_login(client, "billing-org-owner@example.com")
        member_session = await _register_and_login(client, "billing-org-member@example.com")
        owner_id = uuid.UUID(owner_session["user_id"])
        member_id = uuid.UUID(member_session["user_id"])
        organization = Organization(name="Org Checkout Test")
        db_session.add(organization)
        await db_session.flush()
        db_session.add_all(
            [
                OrganizationMembership(
                    organization_id=organization.id,
                    user_id=owner_id,
                    role=ORGANIZATION_ROLE_OWNER,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    joined_at=datetime.now(UTC),
                ),
                OrganizationMembership(
                    organization_id=organization.id,
                    user_id=member_id,
                    role=ORGANIZATION_ROLE_MEMBER,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    joined_at=datetime.now(UTC),
                ),
            ]
        )
        await db_session.commit()

        response = await client.post(
            "/v1/billing/cloud-checkout",
            headers={"Authorization": f"Bearer {owner_session['access_token']}"},
            json={
                "ownerScope": "organization",
                "organizationId": str(organization.id),
                "returnSurface": "desktop",
            },
        )

        assert response.status_code == 200
        assert response.json() == {"url": "https://checkout.test/org"}
        subject = await ensure_organization_billing_subject(db_session, organization.id)
        checkout = captured["checkout"]
        assert isinstance(checkout, dict)
        assert checkout["billing_subject_id"] == str(subject.id)
        assert checkout["organization_id"] == str(organization.id)
        assert checkout["created_by_user_id"] == str(owner_id)
        assert checkout["cloud_monthly_price_id"] == "price_pro"
        assert checkout["overage_price_id"] == "price_overage"
        assert checkout["seat_quantity"] == 2
        assert checkout["success_url"] == "https://app.test/success?returnSurface=desktop"
        assert checkout["cancel_url"] == "https://app.test/cancel?returnSurface=desktop"
        assert checkout["idempotency_key"].startswith(f"cloud-checkout:org:{subject.id}:seats:2:")
        customer = captured["customer"]
        assert isinstance(customer, dict)
        assert customer["organization_id"] == str(organization.id)
        assert customer["created_by_user_id"] == str(owner_id)

    @pytest.mark.asyncio
    async def test_org_cloud_checkout_requires_pro_billing_and_admin_role(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "stripe_checkout_success_url", "https://app.test/success")
        monkeypatch.setattr(settings, "stripe_checkout_cancel_url", "https://app.test/cancel")
        monkeypatch.setattr(
            settings,
            "stripe_customer_portal_return_url",
            "https://app.test/portal",
        )

        owner_session = await _register_and_login(
            client,
            "billing-org-disabled-owner@example.com",
        )
        member_session = await _register_and_login(
            client,
            "billing-org-disabled-member@example.com",
        )
        owner_id = uuid.UUID(owner_session["user_id"])
        member_id = uuid.UUID(member_session["user_id"])
        organization = Organization(name="Org Checkout Gate Test")
        db_session.add(organization)
        await db_session.flush()
        db_session.add_all(
            [
                OrganizationMembership(
                    organization_id=organization.id,
                    user_id=owner_id,
                    role=ORGANIZATION_ROLE_OWNER,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    joined_at=datetime.now(UTC),
                ),
                OrganizationMembership(
                    organization_id=organization.id,
                    user_id=member_id,
                    role=ORGANIZATION_ROLE_MEMBER,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    joined_at=datetime.now(UTC),
                ),
            ]
        )
        await db_session.commit()

        monkeypatch.setattr(settings, "pro_billing_enabled", False)
        disabled_response = await client.post(
            "/v1/billing/cloud-checkout",
            headers={"Authorization": f"Bearer {owner_session['access_token']}"},
            json={
                "ownerScope": "organization",
                "organizationId": str(organization.id),
            },
        )
        assert disabled_response.status_code == 409
        assert disabled_response.json()["detail"]["code"] == "org_pro_billing_disabled"

        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        member_response = await client.post(
            "/v1/billing/cloud-checkout",
            headers={"Authorization": f"Bearer {member_session['access_token']}"},
            json={
                "ownerScope": "organization",
                "organizationId": str(organization.id),
            },
        )
        assert member_response.status_code == 403
        assert member_response.json()["detail"]["code"] == "organization_permission_denied"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("pro_billing_enabled", [False, True])
    async def test_org_refill_checkout_is_not_supported(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
        pro_billing_enabled: bool,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", pro_billing_enabled)
        owner_session = await _register_and_login(
            client,
            f"billing-org-refill-{pro_billing_enabled}@example.com",
        )
        owner_id = uuid.UUID(owner_session["user_id"])
        organization = Organization(name=f"Org Refill {pro_billing_enabled}")
        db_session.add(organization)
        await db_session.flush()
        db_session.add(
            OrganizationMembership(
                organization_id=organization.id,
                user_id=owner_id,
                role=ORGANIZATION_ROLE_OWNER,
                status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                joined_at=datetime.now(UTC),
            )
        )
        await db_session.commit()

        response = await client.post(
            "/v1/billing/refill-checkout",
            headers={"Authorization": f"Bearer {owner_session['access_token']}"},
            json={
                "ownerScope": "organization",
                "organizationId": str(organization.id),
            },
        )

        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "refill_checkout_not_supported_for_org"

    @pytest.mark.asyncio
    async def test_org_cloud_plan_reports_active_member_seats(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        monkeypatch.setattr(settings, "cloud_billing_mode", "observe")
        monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
        monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")

        owner_session = await _register_and_login(client, "billing-org-plan-owner@example.com")
        member_session = await _register_and_login(client, "billing-org-plan-member@example.com")
        owner_id = uuid.UUID(owner_session["user_id"])
        member_id = uuid.UUID(member_session["user_id"])
        now = datetime.now(UTC)
        organization = Organization(name="Org Plan Test")
        db_session.add(organization)
        await db_session.flush()
        db_session.add_all(
            [
                OrganizationMembership(
                    organization_id=organization.id,
                    user_id=owner_id,
                    role=ORGANIZATION_ROLE_OWNER,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    joined_at=now - timedelta(days=1),
                ),
                OrganizationMembership(
                    organization_id=organization.id,
                    user_id=member_id,
                    role=ORGANIZATION_ROLE_MEMBER,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    joined_at=now,
                ),
            ]
        )
        subject = await ensure_organization_billing_subject(db_session, organization.id)
        db_session.add(
            BillingSubscription(
                billing_subject_id=subject.id,
                stripe_subscription_id="sub_org_plan",
                stripe_customer_id="cus_org_plan",
                status="active",
                cancel_at_period_end=False,
                canceled_at=None,
                current_period_start=now - timedelta(days=1),
                current_period_end=now + timedelta(days=29),
                cloud_monthly_price_id="price_pro",
                overage_price_id="price_overage",
                monthly_subscription_item_id="si_org_plan_monthly",
                metered_subscription_item_id="si_org_plan_metered",
                latest_invoice_id=None,
                latest_invoice_status=None,
                hosted_invoice_url=None,
                seat_quantity=1,
            )
        )
        await db_session.commit()

        response = await client.get(
            "/v1/billing/cloud-plan",
            headers={"Authorization": f"Bearer {owner_session['access_token']}"},
            params={
                "ownerScope": "organization",
                "organizationId": str(organization.id),
            },
        )

        assert response.status_code == 200
        payload = response.json()
        assert payload["plan"] == "pro"
        assert payload["billableSeatCount"] == 2
        assert payload["includedManagedCloudHours"] == 40.0
        assert payload["managedCloudOverageCapCents"] == 4000

    @pytest.mark.asyncio
    async def test_org_seat_adjustments_prorate_grants_and_resync_same_member(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        monkeypatch.setattr(settings, "cloud_billing_mode", "observe")
        monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
        monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")

        updates: list[int] = []

        async def fake_update_subscription_item_quantity(**kwargs: object) -> None:
            updates.append(int(kwargs["quantity"]))

        monkeypatch.setattr(
            "proliferate.server.billing.accounting.stripe_billing.update_subscription_item_quantity",
            fake_update_subscription_item_quantity,
        )

        owner_session = await _register_and_login(client, "billing-seat-owner@example.com")
        member_session = await _register_and_login(client, "billing-seat-member@example.com")
        owner_id = uuid.UUID(owner_session["user_id"])
        member_id = uuid.UUID(member_session["user_id"])
        now = datetime.now(UTC)
        period_start = now - timedelta(days=1)
        period_end = now + timedelta(days=29)

        organization = Organization(name="Seat Test Org")
        db_session.add(organization)
        await db_session.flush()
        owner_membership = OrganizationMembership(
            organization_id=organization.id,
            user_id=owner_id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=period_start - timedelta(days=1),
        )
        member_membership = OrganizationMembership(
            organization_id=organization.id,
            user_id=member_id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
        )
        db_session.add_all([owner_membership, member_membership])
        await db_session.flush()
        organization_id = organization.id
        member_membership_id = member_membership.id
        subject = await ensure_organization_billing_subject(db_session, organization.id)
        subject_id = subject.id
        subject.overage_enabled = True
        subscription = BillingSubscription(
            billing_subject_id=subject.id,
            stripe_subscription_id="sub_org_seats",
            stripe_customer_id="cus_org_seats",
            status="active",
            cancel_at_period_end=False,
            canceled_at=None,
            current_period_start=period_start,
            current_period_end=period_end,
            cloud_monthly_price_id="price_pro",
            overage_price_id="price_overage",
            monthly_subscription_item_id="si_org_monthly",
            metered_subscription_item_id="si_org_metered",
            latest_invoice_id=None,
            latest_invoice_status=None,
            hosted_invoice_url=None,
            seat_quantity=1,
        )
        db_session.add(subscription)
        await db_session.flush()

        assert await maybe_create_org_seat_adjustment(
            db_session,
            organization_id=organization_id,
            membership_id=member_membership_id,
        )
        await db_session.commit()
        await process_pending_seat_adjustments()

        db_session.expire_all()
        grants = list(
            (
                await db_session.execute(
                    select(BillingGrant).where(
                        BillingGrant.billing_subject_id == subject_id,
                        BillingGrant.grant_type == PRO_SEAT_PRORATION_GRANT_TYPE,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert updates == [2]
        assert len(grants) == 1
        assert 0 < grants[0].hours_granted < 20

        member = await db_session.get(OrganizationMembership, member_membership_id)
        assert member is not None
        member.status = ORGANIZATION_MEMBERSHIP_STATUS_REMOVED
        member.removed_at = now
        await db_session.flush()
        assert await maybe_create_org_seat_adjustment(
            db_session,
            organization_id=organization_id,
            membership_id=member.id,
        )
        await db_session.commit()
        await process_pending_seat_adjustments()

        db_session.expire_all()
        member = await db_session.get(OrganizationMembership, member_membership_id)
        assert member is not None
        member.status = ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
        member.removed_at = None
        await db_session.flush()
        assert await maybe_create_org_seat_adjustment(
            db_session,
            organization_id=organization_id,
            membership_id=member.id,
        )
        await db_session.commit()
        await process_pending_seat_adjustments()

        db_session.expire_all()
        adjustment_source_refs = list(
            (
                await db_session.execute(
                    select(BillingSeatAdjustment.source_ref).where(
                        BillingSeatAdjustment.billing_subject_id == subject_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        grants = list(
            (
                await db_session.execute(
                    select(BillingGrant).where(
                        BillingGrant.billing_subject_id == subject_id,
                        BillingGrant.grant_type == PRO_SEAT_PRORATION_GRANT_TYPE,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert updates == [2, 1, 2]
        assert len(adjustment_source_refs) == 3
        assert len(set(adjustment_source_refs)) == 3
        assert len(grants) == 1

    @pytest.mark.asyncio
    async def test_prior_period_removed_member_reactivation_gets_prorated_seat_grant(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        monkeypatch.setattr(settings, "cloud_billing_mode", "observe")
        monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
        monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")

        updates: list[int] = []

        async def fake_update_subscription_item_quantity(**kwargs: object) -> None:
            updates.append(int(kwargs["quantity"]))

        monkeypatch.setattr(
            "proliferate.server.billing.accounting.stripe_billing.update_subscription_item_quantity",
            fake_update_subscription_item_quantity,
        )

        owner_session = await _register_and_login(
            client,
            "billing-seat-reactivate-owner@example.com",
        )
        member_session = await _register_and_login(
            client,
            "billing-seat-reactivate-member@example.com",
        )
        owner_id = uuid.UUID(owner_session["user_id"])
        member_id = uuid.UUID(member_session["user_id"])
        now = datetime.now(UTC)
        period_start = now - timedelta(days=1)
        period_end = now + timedelta(days=29)

        organization = Organization(name="Seat Reactivation Test Org")
        db_session.add(organization)
        await db_session.flush()
        organization_id = organization.id
        owner_membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=owner_id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=period_start - timedelta(days=45),
        )
        member_membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=member_id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_REMOVED,
            joined_at=period_start - timedelta(days=45),
            removed_at=period_start - timedelta(days=2),
        )
        db_session.add_all([owner_membership, member_membership])
        await db_session.flush()
        member_membership_id = member_membership.id
        subject = await ensure_organization_billing_subject(db_session, organization_id)
        subject_id = subject.id
        db_session.add(
            BillingSubscription(
                billing_subject_id=subject_id,
                stripe_subscription_id="sub_org_reactivated_seat",
                stripe_customer_id="cus_org_reactivated_seat",
                status="active",
                cancel_at_period_end=False,
                canceled_at=None,
                current_period_start=period_start,
                current_period_end=period_end,
                cloud_monthly_price_id="price_pro",
                overage_price_id="price_overage",
                monthly_subscription_item_id="si_org_reactivated_monthly",
                metered_subscription_item_id="si_org_reactivated_metered",
                latest_invoice_id=None,
                latest_invoice_status=None,
                hosted_invoice_url=None,
                seat_quantity=1,
            )
        )
        await db_session.flush()

        member = await db_session.get(OrganizationMembership, member_membership_id)
        assert member is not None
        member.status = ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE
        member.removed_at = None
        await db_session.flush()
        assert await maybe_create_org_seat_adjustment(
            db_session,
            organization_id=organization_id,
            membership_id=member.id,
        )
        await db_session.commit()
        await process_pending_seat_adjustments()

        db_session.expire_all()
        grants = list(
            (
                await db_session.execute(
                    select(BillingGrant).where(
                        BillingGrant.billing_subject_id == subject_id,
                        BillingGrant.grant_type == PRO_SEAT_PRORATION_GRANT_TYPE,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert updates == [2]
        assert len(grants) == 1
        assert 0 < grants[0].hours_granted < 20

    @pytest.mark.asyncio
    async def test_org_seat_adjustment_retries_after_stripe_failure(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        monkeypatch.setattr(settings, "cloud_billing_mode", "observe")
        monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
        monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")

        updates: list[int] = []

        async def fake_update_subscription_item_quantity(**kwargs: object) -> None:
            updates.append(int(kwargs["quantity"]))
            if len(updates) == 1:
                raise stripe_billing.StripeBillingError(
                    "stripe_temporary_failure",
                    "temporary Stripe failure",
                )

        monkeypatch.setattr(
            "proliferate.server.billing.accounting.stripe_billing.update_subscription_item_quantity",
            fake_update_subscription_item_quantity,
        )

        owner_session = await _register_and_login(
            client,
            "billing-seat-retry-owner@example.com",
        )
        member_session = await _register_and_login(
            client,
            "billing-seat-retry-member@example.com",
        )
        owner_id = uuid.UUID(owner_session["user_id"])
        member_id = uuid.UUID(member_session["user_id"])
        now = datetime.now(UTC)
        period_start = now - timedelta(days=1)
        period_end = now + timedelta(days=29)

        organization = Organization(name="Seat Retry Test Org")
        db_session.add(organization)
        await db_session.flush()
        organization_id = organization.id
        owner_membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=owner_id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=period_start - timedelta(days=1),
        )
        member_membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=member_id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
        )
        db_session.add_all([owner_membership, member_membership])
        await db_session.flush()
        member_membership_id = member_membership.id
        subject = await ensure_organization_billing_subject(db_session, organization_id)
        subject_id = subject.id
        db_session.add(
            BillingSubscription(
                billing_subject_id=subject_id,
                stripe_subscription_id="sub_org_retry_seat",
                stripe_customer_id="cus_org_retry_seat",
                status="active",
                cancel_at_period_end=False,
                canceled_at=None,
                current_period_start=period_start,
                current_period_end=period_end,
                cloud_monthly_price_id="price_pro",
                overage_price_id="price_overage",
                monthly_subscription_item_id="si_org_retry_monthly",
                metered_subscription_item_id="si_org_retry_metered",
                latest_invoice_id=None,
                latest_invoice_status=None,
                hosted_invoice_url=None,
                seat_quantity=1,
            )
        )
        await db_session.flush()

        assert await maybe_create_org_seat_adjustment(
            db_session,
            organization_id=organization_id,
            membership_id=member_membership_id,
        )
        await db_session.commit()

        await process_pending_seat_adjustments()
        db_session.expire_all()

        adjustment = (
            await db_session.execute(
                select(BillingSeatAdjustment).where(
                    BillingSeatAdjustment.billing_subject_id == subject_id,
                )
            )
        ).scalar_one()
        assert updates == [2]
        assert adjustment.status == "failed_retryable"
        assert adjustment.last_error == "temporary Stripe failure"
        subscription = (
            await db_session.execute(
                select(BillingSubscription).where(
                    BillingSubscription.billing_subject_id == subject_id,
                )
            )
        ).scalar_one()
        assert subscription.seat_quantity == 1

        await process_pending_seat_adjustments()
        db_session.expire_all()

        adjustment = (
            await db_session.execute(
                select(BillingSeatAdjustment).where(
                    BillingSeatAdjustment.billing_subject_id == subject_id,
                )
            )
        ).scalar_one()
        grants = list(
            (
                await db_session.execute(
                    select(BillingGrant).where(
                        BillingGrant.billing_subject_id == subject_id,
                        BillingGrant.grant_type == PRO_SEAT_PRORATION_GRANT_TYPE,
                    )
                )
            )
            .scalars()
            .all()
        )
        subscription = (
            await db_session.execute(
                select(BillingSubscription).where(
                    BillingSubscription.billing_subject_id == subject_id,
                )
            )
        ).scalar_one()
        assert updates == [2, 2]
        assert adjustment.status == "succeeded"
        assert adjustment.last_error is None
        assert subscription.seat_quantity == 2
        assert len(grants) == 1
        assert 0 < grants[0].hours_granted < 20

    @pytest.mark.asyncio
    async def test_org_seat_adjustment_marks_repeated_non_stripe_failures_terminal(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        monkeypatch.setattr(settings, "cloud_billing_mode", "observe")
        monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
        monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")

        updates: list[int] = []

        async def fake_update_subscription_item_quantity(**kwargs: object) -> None:
            updates.append(int(kwargs["quantity"]))

        async def fail_ensure_billing_grant_record(*_args: object, **_kwargs: object) -> None:
            raise RuntimeError("grant write failed")

        monkeypatch.setattr(
            "proliferate.server.billing.accounting.stripe_billing.update_subscription_item_quantity",
            fake_update_subscription_item_quantity,
        )
        monkeypatch.setattr(
            "proliferate.server.billing.accounting.ensure_billing_grant_record",
            fail_ensure_billing_grant_record,
        )

        owner_session = await _register_and_login(
            client,
            "billing-seat-terminal-owner@example.com",
        )
        member_session = await _register_and_login(
            client,
            "billing-seat-terminal-member@example.com",
        )
        owner_id = uuid.UUID(owner_session["user_id"])
        member_id = uuid.UUID(member_session["user_id"])
        now = datetime.now(UTC)
        period_start = now - timedelta(days=1)
        period_end = now + timedelta(days=29)

        organization = Organization(name="Seat Terminal Test Org")
        db_session.add(organization)
        await db_session.flush()
        organization_id = organization.id
        db_session.add_all(
            [
                OrganizationMembership(
                    organization_id=organization_id,
                    user_id=owner_id,
                    role=ORGANIZATION_ROLE_OWNER,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    joined_at=period_start - timedelta(days=1),
                ),
                OrganizationMembership(
                    organization_id=organization_id,
                    user_id=member_id,
                    role=ORGANIZATION_ROLE_MEMBER,
                    status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
                    joined_at=now,
                ),
            ]
        )
        await db_session.flush()
        member_membership = (
            await db_session.execute(
                select(OrganizationMembership).where(
                    OrganizationMembership.organization_id == organization_id,
                    OrganizationMembership.user_id == member_id,
                )
            )
        ).scalar_one()
        subject = await ensure_organization_billing_subject(db_session, organization_id)
        subject_id = subject.id
        db_session.add(
            BillingSubscription(
                billing_subject_id=subject_id,
                stripe_subscription_id="sub_org_terminal_seat",
                stripe_customer_id="cus_org_terminal_seat",
                status="active",
                cancel_at_period_end=False,
                canceled_at=None,
                current_period_start=period_start,
                current_period_end=period_end,
                cloud_monthly_price_id="price_pro",
                overage_price_id="price_overage",
                monthly_subscription_item_id="si_org_terminal_monthly",
                metered_subscription_item_id="si_org_terminal_metered",
                latest_invoice_id=None,
                latest_invoice_status=None,
                hosted_invoice_url=None,
                seat_quantity=1,
            )
        )
        await db_session.flush()

        assert await maybe_create_org_seat_adjustment(
            db_session,
            organization_id=organization_id,
            membership_id=member_membership.id,
        )
        await db_session.commit()

        for _ in range(4):
            await process_pending_seat_adjustments()

        db_session.expire_all()
        adjustment = (
            await db_session.execute(
                select(BillingSeatAdjustment).where(
                    BillingSeatAdjustment.billing_subject_id == subject_id,
                )
            )
        ).scalar_one()
        assert updates == [2, 2, 2]
        assert adjustment.status == "failed_terminal"
        assert adjustment.attempt_count == 3
        assert adjustment.last_error == "RuntimeError: grant write failed"

    @pytest.mark.asyncio
    async def test_stale_pending_org_seat_adjustment_does_not_sync_old_quantity(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "pro_billing_enabled", True)
        monkeypatch.setattr(settings, "cloud_billing_mode", "observe")
        monkeypatch.setattr(settings, "stripe_pro_monthly_price_id", "price_pro")
        monkeypatch.setattr(settings, "stripe_legacy_cloud_monthly_price_id", "")

        updates: list[int] = []

        async def fake_update_subscription_item_quantity(**kwargs: object) -> None:
            updates.append(int(kwargs["quantity"]))

        monkeypatch.setattr(
            "proliferate.server.billing.accounting.stripe_billing.update_subscription_item_quantity",
            fake_update_subscription_item_quantity,
        )

        owner_session = await _register_and_login(client, "billing-stale-owner@example.com")
        member_session = await _register_and_login(client, "billing-stale-member@example.com")
        owner_id = uuid.UUID(owner_session["user_id"])
        member_id = uuid.UUID(member_session["user_id"])
        now = datetime.now(UTC)
        period_start = now - timedelta(days=1)
        period_end = now + timedelta(days=29)

        organization = Organization(name="Stale Seat Test Org")
        db_session.add(organization)
        await db_session.flush()
        organization_id = organization.id
        owner_membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=owner_id,
            role=ORGANIZATION_ROLE_OWNER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=period_start - timedelta(days=1),
        )
        member_membership = OrganizationMembership(
            organization_id=organization_id,
            user_id=member_id,
            role=ORGANIZATION_ROLE_MEMBER,
            status=ORGANIZATION_MEMBERSHIP_STATUS_ACTIVE,
            joined_at=now,
        )
        db_session.add_all([owner_membership, member_membership])
        await db_session.flush()
        member_membership_id = member_membership.id
        subject = await ensure_organization_billing_subject(db_session, organization_id)
        subject_id = subject.id
        db_session.add(
            BillingSubscription(
                billing_subject_id=subject_id,
                stripe_subscription_id="sub_stale_org_seats",
                stripe_customer_id="cus_stale_org_seats",
                status="active",
                cancel_at_period_end=False,
                canceled_at=None,
                current_period_start=period_start,
                current_period_end=period_end,
                cloud_monthly_price_id="price_pro",
                overage_price_id="price_overage",
                monthly_subscription_item_id="si_stale_org_monthly",
                metered_subscription_item_id="si_stale_org_metered",
                latest_invoice_id=None,
                latest_invoice_status=None,
                hosted_invoice_url=None,
                seat_quantity=1,
            )
        )
        await db_session.flush()

        assert await maybe_create_org_seat_adjustment(
            db_session,
            organization_id=organization_id,
            membership_id=member_membership_id,
        )
        member = await db_session.get(OrganizationMembership, member_membership_id)
        assert member is not None
        member.status = ORGANIZATION_MEMBERSHIP_STATUS_REMOVED
        member.removed_at = now
        await db_session.flush()
        assert not await maybe_create_org_seat_adjustment(
            db_session,
            organization_id=organization_id,
            membership_id=member_membership_id,
        )
        await db_session.commit()

        await process_pending_seat_adjustments()
        db_session.expire_all()

        assert updates == []
        adjustment = (
            await db_session.execute(
                select(BillingSeatAdjustment).where(
                    BillingSeatAdjustment.billing_subject_id == subject_id,
                )
            )
        ).scalar_one()
        assert adjustment.status == "succeeded"
        assert adjustment.target_quantity == 1
        assert adjustment.grant_quantity == 0
        assert adjustment.last_error == "stale_seat_adjustment_noop"
        subscription = (
            await db_session.execute(
                select(BillingSubscription).where(
                    BillingSubscription.billing_subject_id == subject_id,
                )
            )
        ).scalar_one()
        assert subscription.seat_quantity == 1
        grants = list(
            (
                await db_session.execute(
                    select(BillingGrant).where(
                        BillingGrant.billing_subject_id == subject_id,
                        BillingGrant.grant_type == PRO_SEAT_PRORATION_GRANT_TYPE,
                    )
                )
            )
            .scalars()
            .all()
        )
        assert grants == []

    @pytest.mark.asyncio
    async def test_cloud_plan_surfaces_unlimited_entitlement_with_nullable_hours(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "cloud_billing_mode", "enforce")
        monkeypatch.setattr(settings, "pro_billing_enabled", False)

        session = await _register_and_login(client, "billing-unlimited@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await ensure_personal_billing_subject(db_session, user_id)

        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="main",
            git_base_branch="main",
            status="ready",
            status_detail="Ready",
            last_error=None,
            template_version="v1",
            runtime_generation=1,
        )
        db_session.add(workspace)
        await db_session.flush()
        environment = await ensure_runtime_environment_for_workspace(db_session, workspace)
        environment.status = CloudRuntimeEnvironmentStatus.running.value

        sandbox = CloudSandbox(
            provider="e2b",
            external_sandbox_id="sandbox-123",
            status="running",
            template_version="v1",
            started_at=workspace.created_at,
        )
        db_session.add(sandbox)
        await db_session.flush()
        environment.active_sandbox_id = sandbox.id
        workspace.active_sandbox_id = sandbox.id

        now = datetime.now(UTC)
        db_session.add(
            UsageSegment(
                user_id=user_id,
                billing_subject_id=billing_subject.id,
                runtime_environment_id=environment.id,
                workspace_id=workspace.id,
                sandbox_id=sandbox.id,
                external_sandbox_id=sandbox.external_sandbox_id,
                sandbox_execution_id=None,
                started_at=now - timedelta(hours=3),
                ended_at=now - timedelta(hours=1),
                is_billable=True,
                opened_by="provision",
                closed_by="manual_stop",
            )
        )
        db_session.add(
            BillingEntitlement(
                user_id=user_id,
                billing_subject_id=billing_subject.id,
                kind="unlimited_cloud",
                effective_at=now - timedelta(days=1),
                expires_at=None,
                note="manual override",
            )
        )
        await db_session.commit()

        response = await client.get("/v1/billing/cloud-plan", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["plan"] == "unlimited"
        assert payload["billingMode"] == "enforce"
        assert payload["isUnlimited"] is True
        assert payload["hasUnlimitedCloudHours"] is True
        assert payload["overQuota"] is False
        assert payload["freeSandboxHours"] is None
        assert payload["remainingSandboxHours"] is None
        assert payload["cloudRepoLimit"] == settings.cloud_paid_repo_limit
        assert payload["activeCloudRepoCount"] == 1
        assert payload["usedSandboxHours"] == 2.0
        assert payload["activeSandboxCount"] == 1
        assert payload["startBlocked"] is False

    @pytest.mark.asyncio
    async def test_cloud_plan_counts_historical_billable_usage_without_loading_non_billable_rows(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "cloud_billing_mode", "off")
        monkeypatch.setattr(settings, "cloud_free_sandbox_hours", 10.0)
        monkeypatch.setattr(settings, "pro_billing_enabled", False)

        session = await _register_and_login(client, "billing-history@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        billing_subject = await ensure_personal_billing_subject(db_session, user_id)

        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="main",
            git_base_branch="main",
            status="stopped",
            status_detail="Stopped",
            last_error=None,
            template_version="v1",
            runtime_generation=1,
        )
        db_session.add(workspace)
        await db_session.flush()

        sandbox = CloudSandbox(
            provider="e2b",
            external_sandbox_id="sandbox-history",
            status="paused",
            template_version="v1",
            started_at=workspace.created_at,
        )
        db_session.add(sandbox)
        await db_session.flush()

        now = datetime.now(UTC)
        db_session.add_all(
            [
                UsageSegment(
                    user_id=user_id,
                    billing_subject_id=billing_subject.id,
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                    sandbox_execution_id=None,
                    started_at=now - timedelta(days=140, hours=3),
                    ended_at=now - timedelta(days=140, hours=1),
                    is_billable=True,
                    opened_by="provision",
                    closed_by="manual_stop",
                ),
                UsageSegment(
                    user_id=user_id,
                    billing_subject_id=billing_subject.id,
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                    sandbox_execution_id=None,
                    started_at=now - timedelta(days=135, hours=6),
                    ended_at=now - timedelta(days=135, hours=1),
                    is_billable=False,
                    opened_by="provision",
                    closed_by="provision_failure",
                ),
                UsageSegment(
                    user_id=user_id,
                    billing_subject_id=billing_subject.id,
                    workspace_id=workspace.id,
                    sandbox_id=sandbox.id,
                    external_sandbox_id=sandbox.external_sandbox_id,
                    sandbox_execution_id=None,
                    started_at=now - timedelta(hours=2),
                    ended_at=now - timedelta(hours=1),
                    is_billable=True,
                    opened_by="resume",
                    closed_by="manual_stop",
                ),
            ]
        )
        await db_session.commit()

        response = await client.get("/v1/billing/cloud-plan", headers=headers)
        assert response.status_code == 200
        payload = response.json()
        assert payload["usedSandboxHours"] == 3.0
        assert payload["freeSandboxHours"] == 10.0
        assert payload["remainingSandboxHours"] == 7.0
        assert payload["startBlocked"] is False

    @pytest.mark.asyncio
    async def test_cloud_workspace_create_blocks_after_free_hours_exhausted(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(
            provisioning_service, "schedule_workspace_provision", lambda *_args, **_kwargs: None
        )
        monkeypatch.setattr(settings, "cloud_billing_mode", "enforce")
        monkeypatch.setattr(settings, "cloud_free_sandbox_hours", 1.0)

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main"],
            )

        monkeypatch.setattr(provisioning_preflight, "get_github_repo_branches", _repo_branches)

        session = await _register_and_login(client, "billing-blocked@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        await _link_github_account(db_session, session["user_id"])
        billing_subject = await ensure_personal_billing_subject(db_session, user_id)
        await db_session.commit()

        credential_response = await client.put(
            "/v1/cloud/agent-auth/credentials/synced/claude",
            headers=headers,
            json=_claude_file_payload("test-anthropic-key"),
        )
        assert credential_response.status_code == 200

        now = datetime.now(UTC)
        workspace = CloudWorkspace(
            user_id=user_id,
            billing_subject_id=billing_subject.id,
            display_name="acme/rocket",
            git_provider="github",
            git_owner="acme",
            git_repo_name="rocket",
            git_branch="main",
            git_base_branch="main",
            status="stopped",
            status_detail="Stopped",
            last_error=None,
            template_version="v1",
            runtime_generation=1,
            created_at=now - timedelta(hours=2),
            updated_at=now - timedelta(hours=2),
        )
        db_session.add(workspace)
        await db_session.flush()

        sandbox = CloudSandbox(
            provider="e2b",
            external_sandbox_id="sandbox-exhausted",
            status="paused",
            template_version="v1",
            started_at=now - timedelta(hours=2),
            stopped_at=now - timedelta(hours=1),
        )
        db_session.add(sandbox)
        await db_session.flush()

        db_session.add(
            UsageSegment(
                user_id=user_id,
                billing_subject_id=billing_subject.id,
                workspace_id=workspace.id,
                sandbox_id=sandbox.id,
                external_sandbox_id=sandbox.external_sandbox_id,
                sandbox_execution_id=None,
                started_at=now - timedelta(hours=2),
                ended_at=now - timedelta(hours=0.5),
                is_billable=True,
                opened_by="provision",
                closed_by="manual_stop",
            )
        )
        await db_session.commit()

        response = await client.post(
            "/v1/cloud/workspaces",
            headers=headers,
            json={
                "gitProvider": "github",
                "gitOwner": "acme",
                "gitRepoName": "rocket",
                "baseBranch": "main",
                "branchName": "after-exhaustion",
            },
        )

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "quota_exceeded"
