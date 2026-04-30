from __future__ import annotations

import asyncio
import base64
import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker

from proliferate.config import settings
from proliferate.constants.billing import MONTHLY_CLOUD_GRANT_TYPE
from proliferate.constants.cloud import CloudRuntimeEnvironmentStatus
from proliferate.db.models.auth import OAuthAccount
from proliferate.db.models.billing import (
    BillingEntitlement,
    BillingGrant,
    BillingSubscription,
    UsageSegment,
)
from proliferate.db.models.cloud import CloudSandbox, CloudWorkspace
from proliferate.db.store.billing import (
    ensure_billing_grant,
    ensure_free_included_grant,
    ensure_personal_billing_subject,
)
from proliferate.db.store.cloud_runtime_environments import (
    ensure_runtime_environment_for_workspace,
)
from proliferate.integrations.github import GitHubRepoBranches
from proliferate.server.cloud.workspaces import service as cloud_service


async def _register_and_login(client: AsyncClient, email: str) -> dict[str, str]:
    from proliferate.auth.models import UserCreate
    from proliferate.auth.users import UserManager
    from proliferate.db.engine import get_async_session
    from proliferate.db.store.users import get_user_db

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
            await session.commit()
            user_id = str(user.id)

    assert user_id is not None

    verifier = "test-code-verifier-that-is-long-enough-for-pkce"
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")

    resp = await client.post(
        "/auth/desktop/authorize",
        params={"user_id": user_id},
        json={
            "state": f"billing-state-{uuid.uuid4().hex[:8]}",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "redirect_uri": "proliferate://auth/callback",
        },
    )
    assert resp.status_code == 201
    code = resp.json()["code"]

    resp = await client.post(
        "/auth/desktop/token",
        json={
            "code": code,
            "code_verifier": verifier,
            "grant_type": "authorization_code",
        },
    )
    assert resp.status_code == 200
    token_data = resp.json()
    return {
        "user_id": user_id,
        "access_token": token_data["access_token"],
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

        session = await _register_and_login(client, "billing-overview@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}

        overview_response = await client.get("/v1/billing/overview", headers=headers)
        assert overview_response.status_code == 200
        overview = overview_response.json()
        assert overview == {
            "plan": "free",
            "billingMode": "off",
            "isUnlimited": False,
            "overQuota": False,
            "includedHours": 20.0,
            "usedHours": 0.0,
            "remainingHours": 20.0,
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
        }

        compat_response = await client.get("/v1/billing/plan", headers=headers)
        assert compat_response.status_code == 200
        assert compat_response.json() == {
            "plan": "free",
            "usageMinutes": 0,
        }

        cloud_plan_response = await client.get("/v1/billing/cloud-plan", headers=headers)
        assert cloud_plan_response.status_code == 200
        assert cloud_plan_response.json() == {
            "plan": "free",
            "billingMode": "off",
            "isUnlimited": False,
            "overQuota": False,
            "freeSandboxHours": 20.0,
            "usedSandboxHours": 0.0,
            "remainingSandboxHours": 20.0,
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
        }

    @pytest.mark.asyncio
    async def test_paid_cloud_plan_carries_free_hours_after_signup(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "cloud_free_sandbox_hours", 20.0)
        monkeypatch.setattr(settings, "cloud_billing_mode", "off")
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
        assert payload["freeSandboxHours"] == 120.0
        assert payload["remainingSandboxHours"] == 120.0
        assert payload["concurrentSandboxLimit"] is None

    @pytest.mark.asyncio
    async def test_cloud_plan_surfaces_unlimited_entitlement_with_nullable_hours(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "cloud_billing_mode", "enforce")

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
            runtime_environment_id=environment.id,
            cloud_workspace_id=workspace.id,
            provider="e2b",
            external_sandbox_id="sandbox-123",
            status="running",
            template_version="v1",
            started_at=workspace.created_at,
        )
        db_session.add(sandbox)
        await db_session.flush()
        environment.active_sandbox_id = sandbox.id

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
        assert payload["overQuota"] is False
        assert payload["freeSandboxHours"] is None
        assert payload["remainingSandboxHours"] is None
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
            cloud_workspace_id=workspace.id,
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
            cloud_service,
            "schedule_workspace_provision",
            lambda _workspace_id, **_kwargs: None,
        )
        monkeypatch.setattr(settings, "cloud_billing_mode", "enforce")
        monkeypatch.setattr(settings, "cloud_free_sandbox_hours", 1.0)

        async def _repo_branches(*_args, **_kwargs) -> GitHubRepoBranches:
            return GitHubRepoBranches(
                default_branch="main",
                branches=["main"],
            )

        monkeypatch.setattr(cloud_service, "get_github_repo_branches", _repo_branches)

        session = await _register_and_login(client, "billing-blocked@example.com")
        headers = {"Authorization": f"Bearer {session['access_token']}"}
        user_id = uuid.UUID(session["user_id"])
        await _link_github_account(db_session, session["user_id"])
        billing_subject = await ensure_personal_billing_subject(db_session, user_id)

        credential_response = await client.put(
            "/v1/cloud/credentials/claude",
            headers=headers,
            json={
                "authMode": "env",
                "envVars": {"ANTHROPIC_API_KEY": "test-anthropic-key"},
            },
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
            cloud_workspace_id=workspace.id,
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
